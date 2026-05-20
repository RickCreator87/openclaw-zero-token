/**
 * HTML report generator for E2E test results.
 */
import fs from "node:fs/promises";
import path from "node:path";

export interface TestResult {
  model: string;
  l2: LayerResult;
  l3: LayerResult;
  l5: LayerResult;
}

export interface LayerResult {
  status: "pass" | "fail" | "skip";
  responseTimeMs?: number;
  contentLength?: number;
  contentPreview?: string;
  error?: string;
  extra?: Record<string, unknown>;
}

export interface ReportData {
  timestamp: string;
  duration: string;
  results: TestResult[];
  antiBanStats: { currentDelay: number; rateLimitEvents: number; retryCount: number };
  env: {
    nodeVersion: string;
    gatewayPort: string;
    chromePort: string;
    configPath: string;
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badge(status: "pass" | "fail" | "skip"): string {
  const colors = { pass: "#22c55e", fail: "#ef4444", skip: "#eab308" };
  const labels = { pass: "PASS", fail: "FAIL", skip: "SKIP" };
  return `<span style="background:${colors[status]};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold">${labels[status]}</span>`;
}

function layerRow(name: string, r: LayerResult): string {
  const time = r.responseTimeMs != null ? `${(r.responseTimeMs / 1000).toFixed(1)}s` : "-";
  const len = r.contentLength != null ? `${r.contentLength} chars` : "-";
  const preview = r.contentPreview ? escapeHtml(r.contentPreview.slice(0, 150)) : "-";
  const error = r.error
    ? `<span style="color:#ef4444">${escapeHtml(r.error.slice(0, 200))}</span>`
    : "";

  return `
    <tr>
      <td style="padding:6px 12px">${name}</td>
      <td style="padding:6px 12px">${badge(r.status)}</td>
      <td style="padding:6px 12px">${time}</td>
      <td style="padding:6px 12px">${len}</td>
      <td style="padding:6px 12px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${error || preview}</td>
    </tr>`;
}

function modelCard(r: TestResult): string {
  const overall = [r.l2.status, r.l3.status, r.l5.status].includes("fail")
    ? "fail"
    : [r.l2.status, r.l3.status, r.l5.status].every((s) => s === "skip")
      ? "skip"
      : "pass";

  return `
  <div style="border:1px solid #e5e7eb;border-radius:8px;margin:12px 0;overflow:hidden">
    <div style="background:${overall === "pass" ? "#f0fdf4" : overall === "fail" ? "#fef2f2" : "#fefce8"};padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
      <strong style="font-size:16px">${escapeHtml(r.model)}</strong>
      ${badge(overall)}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="background:#f9fafb">
        <th style="padding:6px 12px;text-align:left;width:80px">Layer</th>
        <th style="padding:6px 12px;text-align:left;width:70px">Status</th>
        <th style="padding:6px 12px;text-align:left;width:80px">Time</th>
        <th style="padding:6px 12px;text-align:left;width:100px">Length</th>
        <th style="padding:6px 12px;text-align:left">Detail</th>
      </tr>
      ${layerRow("L2 HTTP", r.l2)}
      ${layerRow("L3 WS", r.l3)}
      ${layerRow("L5 UI", r.l5)}
    </table>
  </div>`;
}

export async function generateHtmlReport(data: ReportData): Promise<string> {
  const total = data.results.length;
  const passed = data.results.filter(
    (r) => r.l2.status === "pass" || r.l3.status === "pass" || r.l5.status === "pass",
  ).length;
  const failed = data.results.filter((r) =>
    [r.l2.status, r.l3.status, r.l5.status].includes("fail"),
  ).length;

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Model E2E Test Report - ${escapeHtml(data.timestamp)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 20px; }
    .summary { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 24px; flex: 1; text-align: center; }
    .stat .num { font-size: 32px; font-weight: bold; }
    .stat .label { font-size: 12px; color: #64748b; margin-top: 4px; }
    .section { margin-top: 24px; }
    .section h2 { font-size: 18px; margin-bottom: 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    .env-table { font-size: 13px; }
    .env-table td { padding: 4px 12px; }
    .env-table td:first-child { font-weight: bold; color: #64748b; }
  </style>
</head>
<body>
  <h1>Web Model E2E Test Report</h1>
  <div class="meta">${escapeHtml(data.timestamp)} | Duration: ${escapeHtml(data.duration)}</div>

  <div class="summary">
    <div class="stat"><div class="num">${total}</div><div class="label">Total Models</div></div>
    <div class="stat"><div class="num" style="color:#22c55e">${passed}</div><div class="label">Passed</div></div>
    <div class="stat"><div class="num" style="color:#ef4444">${failed}</div><div class="label">Failed</div></div>
  </div>

  <div class="section">
    <h2>Test Results</h2>
    ${data.results.map(modelCard).join("")}
  </div>

  <div class="section">
    <h2>Anti-Ban Stats</h2>
    <table class="env-table">
      <tr><td>Current Delay</td><td>${data.antiBanStats.currentDelay.toFixed(1)}s</td></tr>
      <tr><td>Rate Limit Events</td><td>${data.antiBanStats.rateLimitEvents}</td></tr>
      <tr><td>Retry Count</td><td>${data.antiBanStats.retryCount}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Environment</h2>
    <table class="env-table">
      <tr><td>Node Version</td><td>${escapeHtml(data.env.nodeVersion)}</td></tr>
      <tr><td>Gateway Port</td><td>${escapeHtml(data.env.gatewayPort)}</td></tr>
      <tr><td>Chrome Port</td><td>${escapeHtml(data.env.chromePort)}</td></tr>
      <tr><td>Config Path</td><td>${escapeHtml(data.env.configPath)}</td></tr>
    </table>
  </div>
</body>
</html>`;

  const reportDir = process.env.ZT_REPORT_DIR || "reports";
  await fs.mkdir(reportDir, { recursive: true });
  const fileName = `web-model-e2e-${data.timestamp.replace(/[: ]/g, "-")}.html`;
  const filePath = path.join(reportDir, fileName);
  await fs.writeFile(filePath, html, "utf-8");

  return filePath;
}
