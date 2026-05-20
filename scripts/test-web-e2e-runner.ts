#!/usr/bin/env tsx
/**
 * Web Model E2E Test Runner — Two-Phase: TUI first, WebUI second
 *
 * Phase 1 (TUI): L2 HTTP API + L3 WebSocket for all models
 * Phase 2 (WebUI): L5 Playwright browser UI, only for TUI-passed models
 *
 * Environment variables:
 *   ZT_GATEWAY_PORT, ZT_CHROME_PORT, ZT_TIMEOUT, ZT_BASE_DELAY, ZT_MAX_DELAY,
 *   ZT_REPORT_DIR, ZT_MODELS (comma-separated), ZT_GATEWAY_TOKEN,
 *   ZT_SKIP_L2, ZT_SKIP_L3, ZT_SKIP_L5
 */

import fs from "node:fs";
import path from "node:path";
import { AntiBanController, interleaveModels } from "./lib/e2e-anti-ban.js";
import {
  generateHtmlReport,
  type TestResult,
  type LayerResult,
  type ReportData,
} from "./lib/e2e-html-report.js";
import { MessagePool } from "./lib/e2e-message-pool.js";
import { testL2Http } from "./lib/e2e-test-l2-http.js";
import { testL3WebSocket } from "./lib/e2e-test-l3-ws.js";
import { testL5BrowserUI } from "./lib/e2e-test-l5-ui.js";

// ─── Config ──────────────────────────────────────────────────
const PORT = process.env.ZT_GATEWAY_PORT || "3001";
const CHROME_PORT = process.env.ZT_CHROME_PORT || "9222";
const TIMEOUT_MS = (Number(process.env.ZT_TIMEOUT) || 120) * 1000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/`;
const TOKEN = process.env.ZT_GATEWAY_TOKEN || "";
const SKIP_L2 = process.env.ZT_SKIP_L2 === "1";
const SKIP_L3 = process.env.ZT_SKIP_L3 === "1";
const SKIP_L5 = process.env.ZT_SKIP_L5 === "1";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE_DIR = path.join(ROOT, ".openclaw-upstream-state");
const CONFIG_FILE = path.join(STATE_DIR, "openclaw.json");
const AUTH_FILE = path.join(STATE_DIR, "agents/main/agent/auth-profiles.json");
const GW_LOG = "/tmp/openclaw-e2e-gateway.log";

const ALL_WEB_MODELS: Record<string, string> = {
  "claude-web": "claude-sonnet-4-6",
  "chatgpt-web": "gpt-4",
  "deepseek-web": "deepseek-chat",
  "doubao-web": "doubao-seed-2.0",
  "qwen-web": "qwen3.5-plus",
  "qwen-cn-web": "Qwen3.5-Plus",
  "kimi-web": "moonshot-v1-32k",
  "gemini-web": "gemini-pro",
  "grok-web": "grok-2",
  "glm-web": "glm-4-plus",
  "glm-intl-web": "glm-4-plus",
  "perplexity-web": "perplexity-web",
  "xiaomimo-web": "xiaomimo-chat",
};

// ─── Helpers ─────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function info(msg: string) {
  console.log(`${C.blue}[INFO]${C.reset}  ${msg}`);
}
function ok(msg: string) {
  console.log(`${C.green}[PASS]${C.reset}  ${msg}`);
}
function fail(msg: string) {
  console.log(`${C.red}[FAIL]${C.reset}  ${msg}`);
}
function warn(msg: string) {
  console.log(`${C.yellow}[WARN]${C.reset}  ${msg}`);
}
function header(msg: string) {
  console.log("");
  console.log(`${C.cyan}${"═".repeat(50)}${C.reset}`);
  console.log(`${C.cyan}  ${msg}${C.reset}`);
  console.log(`${C.cyan}${"═".repeat(50)}${C.reset}`);
}

function skipResult(): LayerResult {
  return { status: "skip" };
}

/** Read recent gateway log lines for a specific provider keyword */
function readGatewayLog(keyword: string, lines = 30): string {
  try {
    const content = fs.readFileSync(GW_LOG, "utf-8");
    const allLines = content.split("\n");
    const relevant = allLines.filter(
      (l) => l.includes(keyword) || l.includes("error") || l.includes("Error"),
    );
    return relevant.slice(-lines).join("\n");
  } catch {
    return "(gateway log not available)";
  }
}

// ─── Discover authorized models ──────────────────────────────
function discoverModels(): string[] {
  const envModels = process.env.ZT_MODELS;
  if (envModels) {
    return envModels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf-8");
    const data = JSON.parse(raw);
    const profiles = Object.keys(data.profiles || {});
    const models: string[] = [];

    for (const key of profiles) {
      const provider = key.replace(/:.*$/, "");
      if (provider.endsWith("-web") && ALL_WEB_MODELS[provider]) {
        models.push(`${provider}/${ALL_WEB_MODELS[provider]}`);
      }
    }
    return models;
  } catch {
    warn("Cannot read auth-profiles.json, using full model list");
    return Object.entries(ALL_WEB_MODELS).map(([p, m]) => `${p}/${m}`);
  }
}

function readToken(): string {
  if (TOKEN) {
    return TOKEN;
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw);
    return config?.gateway?.auth?.token || "";
  } catch {
    return "";
  }
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  const token = readToken();
  if (!token) {
    fail("No gateway token found. Set ZT_GATEWAY_TOKEN or check openclaw.json");
    process.exit(1);
  }

  const rawModels = discoverModels();
  if (rawModels.length === 0) {
    fail("No models to test");
    process.exit(1);
  }

  const models = interleaveModels(rawModels);
  info(`Testing ${models.length} models (interleaved for anti-ban)`);
  models.forEach((m, i) => info(`  ${i + 1}. ${m}`));

  const pool = new MessagePool();
  const antiBan = new AntiBanController();

  // Results tracking
  const resultMap = new Map<string, TestResult>();
  for (const m of models) {
    resultMap.set(m, { model: m, l2: skipResult(), l3: skipResult(), l5: skipResult() });
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1: TUI Tests (L2 HTTP + L3 WebSocket)
  // ═══════════════════════════════════════════════════════════
  header("Phase 1: TUI Tests (L2 HTTP + L3 WebSocket)");

  const tuiPassed: string[] = [];
  const tuiFailed: string[] = [];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const provider = model.split("/")[0];
    const message = pool.pick(provider);
    const r = resultMap.get(model)!;

    console.log("");
    console.log(`${C.cyan}── [${i + 1}/${models.length}] ${model} ──${C.reset}`);
    info(`Message: "${message.slice(0, 60)}${message.length > 60 ? "..." : ""}"`);

    let tuiOk = false;

    // L2: HTTP API
    if (SKIP_L2) {
      info("L2 HTTP: skipped");
    } else {
      info("L2 HTTP: testing...");
      const l2 = await testL2Http({
        baseUrl: BASE_URL,
        token,
        model,
        message,
        timeoutMs: TIMEOUT_MS,
      });
      r.l2 = { ...l2 };
      if (l2.status === "pass") {
        ok(`L2 HTTP: ${l2.contentLength} chars, ${((l2.responseTimeMs || 0) / 1000).toFixed(1)}s`);
        if (l2.contentPreview) {
          info(`  Preview: ${l2.contentPreview.slice(0, 120)}...`);
        }
        antiBan.onSuccess();
        tuiOk = true;
      } else {
        fail(`L2 HTTP: ${l2.error}`);
        // Dump relevant gateway logs for diagnosis
        const providerTag = provider.replace("-web", "");
        const logSnippet = readGatewayLog(providerTag, 15);
        if (logSnippet && logSnippet !== "(gateway log not available)") {
          console.log(`${C.dim}  --- Gateway log (${provider}) ---${C.reset}`);
          for (const line of logSnippet.split("\n").slice(-10)) {
            console.log(`${C.dim}  ${line}${C.reset}`);
          }
          console.log(`${C.dim}  --- end log ---${C.reset}`);
        }
        if (l2.httpCode === 429) {
          antiBan.onRateLimit();
        }
      }
    }

    // L3: WebSocket
    if (SKIP_L3) {
      info("L3 WS: skipped");
    } else {
      info("L3 WS: testing...");
      const l3 = await testL3WebSocket({
        wsUrl: WS_URL,
        token,
        model,
        message,
        timeoutMs: TIMEOUT_MS,
      });
      r.l3 = { ...l3, extra: l3.deltaCount != null ? { deltaCount: l3.deltaCount } : undefined };
      if (l3.status === "pass") {
        ok(
          `L3 WS: ${l3.contentLength} chars, ${l3.deltaCount} deltas, ${((l3.responseTimeMs || 0) / 1000).toFixed(1)}s`,
        );
        if (l3.contentPreview) {
          info(`  Preview: ${l3.contentPreview.slice(0, 120)}...`);
        }
        antiBan.onSuccess();
        tuiOk = true;
      } else {
        fail(`L3 WS: ${l3.error}`);
      }
    }

    if (tuiOk) {
      tuiPassed.push(model);
    } else {
      tuiFailed.push(model);
    }

    // Anti-ban wait between models
    if (i < models.length - 1) {
      await antiBan.wait();
    }
  }

  // TUI Summary
  header("Phase 1 Results: TUI");
  for (const m of tuiPassed) {
    console.log(`  ${C.green}PASS${C.reset}  ${m}`);
  }
  for (const m of tuiFailed) {
    console.log(`  ${C.red}FAIL${C.reset}  ${m}`);
  }
  console.log("");
  info(`TUI: ${tuiPassed.length} passed, ${tuiFailed.length} failed out of ${models.length}`);

  // ═══════════════════════════════════════════════════════════
  // Phase 2: WebUI Tests (L5 Playwright) — only TUI-passed models
  // ═══════════════════════════════════════════════════════════
  if (SKIP_L5) {
    header("Phase 2: WebUI Tests [SKIPPED]");
    info("L5 skipped via --skip-l5");
  } else if (tuiPassed.length === 0) {
    header("Phase 2: WebUI Tests [SKIPPED]");
    warn("No models passed TUI, skipping WebUI phase entirely");
  } else {
    header(`Phase 2: WebUI Tests (${tuiPassed.length} models)`);
    info("Only testing models that passed TUI phase");

    const pool2 = new MessagePool(); // Fresh pool for different messages

    for (let i = 0; i < tuiPassed.length; i++) {
      const model = tuiPassed[i];
      const provider = model.split("/")[0];
      const message = pool2.pick(provider);
      const r = resultMap.get(model)!;

      console.log("");
      console.log(`${C.cyan}── [${i + 1}/${tuiPassed.length}] ${model} (WebUI) ──${C.reset}`);
      info(`Message: "${message.slice(0, 60)}${message.length > 60 ? "..." : ""}"`);

      info("L5 UI: testing...");
      const l5 = await testL5BrowserUI({
        gatewayUrl: BASE_URL,
        token,
        model,
        message,
        timeoutMs: TIMEOUT_MS,
        screenshotDir: path.join(ROOT, "reports", "screenshots"),
      });
      r.l5 = { ...l5 };

      if (l5.status === "pass") {
        ok(`L5 UI: ${l5.contentLength} chars, ${((l5.responseTimeMs || 0) / 1000).toFixed(1)}s`);
        if (l5.contentPreview) {
          info(`  Preview: ${l5.contentPreview.slice(0, 120)}...`);
        }
        antiBan.onSuccess();
      } else {
        fail(`L5 UI: ${l5.error}`);
        if (l5.screenshotPath) {
          info(`  Screenshot: ${l5.screenshotPath}`);
        }
      }

      if (i < tuiPassed.length - 1) {
        await antiBan.wait();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Final Summary
  // ═══════════════════════════════════════════════════════════
  const results = Array.from(resultMap.values());
  const duration = ((Date.now() - startTime) / 1000).toFixed(0);
  const durationStr = `${Math.floor(Number(duration) / 60)}m ${Number(duration) % 60}s`;

  header("Final Summary");

  let totalPass = 0;
  let totalFail = 0;
  for (const r of results) {
    const layers = [r.l2.status, r.l3.status, r.l5.status];
    const hasPass = layers.some((s) => s === "pass");
    const hasFail = layers.some((s) => s === "fail");
    const tuiStatus =
      r.l2.status === "pass" || r.l3.status === "pass"
        ? `${C.green}TUI:OK${C.reset}`
        : `${C.red}TUI:FAIL${C.reset}`;
    const uiStatus =
      r.l5.status === "pass"
        ? `${C.green}UI:OK${C.reset}`
        : r.l5.status === "skip"
          ? `${C.dim}UI:SKIP${C.reset}`
          : `${C.red}UI:FAIL${C.reset}`;

    console.log(`  ${tuiStatus}  ${uiStatus}  ${r.model}`);
    if (hasPass) {
      totalPass++;
    }
    if (hasFail) {
      totalFail++;
    }
  }

  console.log("");
  console.log(
    `  Total: ${results.length} | Pass: ${totalPass} | Fail: ${totalFail} | Duration: ${durationStr}`,
  );

  // HTML Report
  const reportData: ReportData = {
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    duration: durationStr,
    results,
    antiBanStats: antiBan.stats,
    env: {
      nodeVersion: process.version,
      gatewayPort: PORT,
      chromePort: CHROME_PORT,
      configPath: CONFIG_FILE,
    },
  };

  try {
    const reportPath = await generateHtmlReport(reportData);
    console.log("");
    ok(`HTML report: ${reportPath}`);
  } catch (err: unknown) {
    warn(`Failed to generate HTML report: ${err instanceof Error ? err.message : String(err)}`);
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("E2E runner crashed:", err);
  process.exit(2);
});
