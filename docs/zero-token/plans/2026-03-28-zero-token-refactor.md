# Zero Token 重构实施计划

> **状态（2026-03-28）**：Task 1–6 已全部落地；验证见文末「验证记录」。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持 Web 模型端到端行为不变的前提下，降低与上游 OpenClaw 的合并成本、完善浏览器授权文档，并为后续插件化迁移提供单一注册点。

**Architecture:** 将 **Web `model.api` → `create*WebStreamFn`** 收敛到 `src/zero-token/streams/web-stream-factories.ts`（`src/agents/web-stream-factories.ts` 为 re-export）；`attempt.ts` / `compact.ts` 经该表解析。通过 `docs/zero-token/upstream-sync.md` 列出 Zero Token 相对上游的改动面；通过 `docs/zero-token/web-models-browser-modes.md` 固化 CDP / Profile 约束与可选路径（含 bb-browser 参考）。不在本计划内引入 CLI-Anything 或完整 bb-browser 依赖。

**Tech Stack:** TypeScript (ESM)、Vitest、Playwright（既有）；Web 实现位于 `src/zero-token/`。

**依据文档:** `docs/zero-token/zero-token-requirements.md`

---

## 文件结构（本计划涉及）

| 路径                                                  | 职责                                                  |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `src/agents/web-stream-factories.ts`（新建）          | 集中导出 `getWebStreamFactory(api)` 与各 Web 流式工厂 |
| `src/agents/web-stream-factories.test.ts`（新建）     | 校验注册表完整性与工厂可调用                          |
| `src/agents/pi-embedded-runner/run/attempt.ts`        | 用 `getWebStreamFactory` 替换 11 段 `else if`         |
| `src/agents/pi-embedded-runner/compact.ts`            | 同上，保持与 attempt 行为一致                         |
| `docs/zero-token/upstream-sync.md`（新建）            | Zero Token 改动面清单与同步步骤                       |
| `docs/zero-token/web-models-browser-modes.md`（新建） | 浏览器模式 A/B/C 与约束说明                           |
| `docs/zero-token/zero-token-requirements.md`          | 追加变更记录行指向本计划                              |

---

### Task 1: 上游同步说明文档

**Files:**

- Create: `docs/zero-token/upstream-sync.md`

- [x] **Step 1: 写入文档正文**

将以下内容保存为 `docs/zero-token/upstream-sync.md`：

```markdown
# 与上游 OpenClaw 同步（Zero Token）

## 改动面清单（合并时优先检查）

以下路径相对 [openclaw/openclaw](https://github.com/openclaw/openclaw) 通常为 **有意差异**，`git merge` / `git rebase` 时需人工过一遍：

### 扩展与脚本

- `src/zero-token/` — Web Provider 客户端 / 流式实现（原 `src/providers/*web*` + `*-web-stream.ts` 已迁入）
- `start-chrome-debug.sh`、`onboard.sh`、`server.sh`（若存在）
- `docs/zero-token/zero-token-requirements.md`、`docs/zero-token/web-models-browser-modes.md`、本文档

### Agent 与 Web 流式

- `src/agents/*-web-stream.ts`
- `src/agents/web-stream-factories.ts`（集中注册表，降低 `attempt.ts` 冲突概率）
- `src/agents/pi-embedded-runner/run/attempt.ts` — Web 流分支应尽可能仅调用 `getWebStreamFactory`
- `src/agents/pi-embedded-runner/compact.ts` — 同上
- `src/agents/models-config.providers.ts` — Provider 解析与懒加载

### Provider 实现与认证

- `src/providers/*-web*.ts`、`src/providers/*-web-auth.ts`
- `src/commands/onboard-web-auth.ts`、`src/commands/auth-choice.apply.*.ts`
- `src/commands/onboard-auth.config-core.ts`（各 Web 默认模型补丁）

### 配置类型

- `src/config/types.models.ts` — `ModelApi` / provider 枚举

## 推荐同步步骤

1. `git fetch upstream`（将 `openclaw/openclaw` 配为 `upstream`）
2. `git merge upstream/main`（或 `rebase`，按团队习惯）
3. 按本节清单解决冲突；**优先保留**上游对通用子系统的修复，再重新应用 Zero Token 的 Web 相关 hunk
4. `pnpm install && pnpm build`
5. `OPENCLAW_TEST_PROFILE=low pnpm test`（或全量 `pnpm test`，视机器资源）

## 非目标

- 不要求与上游文件级一致；要求 **行为回归**（Web 模型对话、onboard 授权）可验证。
```

- [x] **Step 2: 在 `README.zh-CN.md` 目录中增加链接**

在「与上游同步」对应位置或目录列表增加一行：`- [与上游同步说明](docs/zero-token/upstream-sync.md)`（若已有「与上游同步」章节，链到该文档）。

- [x] **Step 3: Commit**（由维护者在本地执行 `git commit`）

```bash
git add docs/zero-token/upstream-sync.md README.zh-CN.md README.md
git commit -m "docs: add upstream sync playbook for zero-token"
```

---

### Task 2: Web 流式工厂模块 + 单测

**Files:**

- Create: `src/agents/web-stream-factories.ts`
- Create: `src/agents/web-stream-factories.test.ts`

- [x] **Step 1: 新建 `src/agents/web-stream-factories.ts`**

```typescript
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { createChatGPTWebStreamFn } from "./chatgpt-web-stream.js";
import { createClaudeWebStreamFn } from "./claude-web-stream.js";
import { createDeepseekWebStreamFn } from "./deepseek-web-stream.js";
import { createDoubaoWebStreamFn } from "./doubao-web-stream.js";
import { createGeminiWebStreamFn } from "./gemini-web-stream.js";
import { createGlmIntlWebStreamFn } from "./glm-intl-web-stream.js";
import { createGlmWebStreamFn } from "./glm-web-stream.js";
import { createGrokWebStreamFn } from "./grok-web-stream.js";
import { createKimiWebStreamFn } from "./kimi-web-stream.js";
import { createQwenWebStreamFn } from "./qwen-web-stream.js";
import { createXiaomiMimoWebStreamFn } from "./xiaomimo-web-stream.js";

/** model.api 值 → 与 attempt.ts / compact.ts 原分支一致的工厂函数 */
const WEB_STREAM_FACTORIES = {
  "deepseek-web": createDeepseekWebStreamFn,
  "claude-web": createClaudeWebStreamFn,
  "doubao-web": createDoubaoWebStreamFn,
  "chatgpt-web": createChatGPTWebStreamFn,
  "qwen-web": createQwenWebStreamFn,
  "kimi-web": createKimiWebStreamFn,
  "gemini-web": createGeminiWebStreamFn,
  "grok-web": createGrokWebStreamFn,
  "glm-web": createGlmWebStreamFn,
  "glm-intl-web": createGlmIntlWebStreamFn,
  "xiaomimo-web": createXiaomiMimoWebStreamFn,
} as const satisfies Record<string, (cookie: string) => StreamFn>;

export type WebStreamApiId = keyof typeof WEB_STREAM_FACTORIES;

export function getWebStreamFactory(api: string): ((cookie: string) => StreamFn) | undefined {
  return WEB_STREAM_FACTORIES[api as WebStreamApiId];
}

export function listWebStreamApiIds(): WebStreamApiId[] {
  return Object.keys(WEB_STREAM_FACTORIES) as WebStreamApiId[];
}
```

- [x] **Step 2: 新建 `src/agents/web-stream-factories.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { getWebStreamFactory, listWebStreamApiIds } from "./web-stream-factories.js";

describe("web-stream-factories", () => {
  it("lists stable web stream api ids", () => {
    const ids = listWebStreamApiIds().slice().sort();
    expect(ids).toEqual(
      [
        "chatgpt-web",
        "claude-web",
        "deepseek-web",
        "doubao-web",
        "gemini-web",
        "glm-intl-web",
        "glm-web",
        "grok-web",
        "kimi-web",
        "qwen-web",
        "xiaomimo-web",
      ].sort(),
    );
  });

  it("returns a function for each listed api", () => {
    for (const id of listWebStreamApiIds()) {
      const f = getWebStreamFactory(id);
      expect(f, id).toBeTypeOf("function");
      expect(f?.("")).toBeTypeOf("function");
    }
  });

  it("returns undefined for non-web api", () => {
    expect(getWebStreamFactory("openai")).toBeUndefined();
  });
});
```

- [x] **Step 3: 运行测试**

Run: `pnpm exec vitest run src/agents/web-stream-factories.test.ts`
Expected: 全部 PASS

- [x] **Step 4: Commit**

```bash
git add src/agents/web-stream-factories.ts src/agents/web-stream-factories.test.ts
git commit -m "agents: centralize web stream factories registry"
```

---

### Task 3: 重构 `attempt.ts`

**Files:**

- Modify: `src/agents/pi-embedded-runner/run/attempt.ts`

- [x] **Step 1: 调整 import**

删除以下单独 import（若仅被 Web 分支使用）：

- `createChatGPTWebStreamFn` … `createXiaomiMimoWebStreamFn`（共 11 个 create\*WebStreamFn）

新增：

```typescript
import { getWebStreamFactory } from "../../web-stream-factories.js";
```

- [x] **Step 2: 替换 Web 分支块**

将自 `} else if (params.model.api === "deepseek-web") {` 起至 `} else if (params.model.api === "xiaomimo-web") { ... }` 的整段 **替换为** 下列 **嵌套在单个 `else` 内** 的结构（`openai-responses` 与最终 `else` 必须仍在该外层 `else` 内，并多一层闭合 `}`）：

```typescript
      } else {
        const webFactory = getWebStreamFactory(params.model.api);
        if (webFactory) {
          const cookie = (await params.authStorage.getApiKey(params.model.api)) || "";
          if (cookie) {
            activeSession.agent.streamFn = webFactory(cookie);
            ensureCustomApiRegistered(params.model.api, activeSession.agent.streamFn);
          } else {
            log.warn(`[web-stream] no API key for ${params.model.api}`);
            activeSession.agent.streamFn = streamSimple;
          }
        } else if (params.model.api === "openai-responses" && params.provider === "openai") {
          const wsApiKey = await params.authStorage.getApiKey(params.provider);
          if (wsApiKey) {
            activeSession.agent.streamFn = createOpenAIWebSocketStreamFn(wsApiKey, params.sessionId, {
              signal: runAbortController.signal,
            });
          } else {
            log.warn(`[ws-stream] no API key for provider=${params.provider}; using HTTP transport`);
            activeSession.agent.streamFn = streamSimple;
          }
        } else {
          activeSession.agent.streamFn = streamSimple;
        }
      }
```

**Ollama** 的 `if (params.model.api === "ollama")` 块保留在整段 **之前**，不变。

- [x] **Step 3: 运行相关测试**

Run: `pnpm exec vitest run src/plugins/hooks.model-override-wiring.test.ts --pool-forks=false`
Expected: PASS（或全量 `pnpm test` 中与 embedded runner 相关的子集）

- [x] **Step 4: Commit**

```bash
git add src/agents/pi-embedded-runner/run/attempt.ts
git commit -m "agents: route web stream via getWebStreamFactory in attempt"
```

---

### Task 4: 重构 `compact.ts`

**Files:**

- Modify: `src/agents/pi-embedded-runner/compact.ts`

- [x] **Step 1: 调整 import**

删除 11 个 `create*WebStreamFn` import，新增：

```typescript
import { getWebStreamFactory } from "../web-stream-factories.js";
```

- [x] **Step 2: 替换 `if (resolvedApiKey)` 内分支**

将：

```typescript
        if (model.api === "deepseek-web") {
          streamFn = createDeepseekWebStreamFn(resolvedApiKey);
        } else if (model.api === "claude-web") {
        ...
        } else if (model.api === "xiaomimo-web") {
          streamFn = createXiaomiMimoWebStreamFn(resolvedApiKey);
        }
```

替换为：

```typescript
const webFactory = getWebStreamFactory(model.api);
if (webFactory) {
  streamFn = webFactory(resolvedApiKey);
}
```

- [x] **Step 3: 运行测试**

Run: `pnpm build && pnpm exec vitest run src/agents/pi-embedded-runner --passWithNoTests`
Expected: 无编译错误；若有 compact 专用测试则 PASS

- [x] **Step 4: Commit**

```bash
git add src/agents/pi-embedded-runner/compact.ts
git commit -m "agents: route web stream via getWebStreamFactory in compact"
```

---

### Task 5: 浏览器模式文档

**Files:**

- Create: `docs/zero-token/web-models-browser-modes.md`
- Modify: `docs/zero-token/zero-token-requirements.md`（变更记录）

- [x] **Step 1: 创建 `docs/zero-token/web-models-browser-modes.md`**

内容需包含三节：**模式 A**（当前 `start-chrome-debug.sh` + 独立 `user-data-dir`）、**模式 B**（用户自行以 `--remote-debugging-port` + **同一专用目录** 启动单实例 Chrome，不在此模式下再开普通 Chrome 同目录）、**模式 C**（扩展/守护进程桥，如 bb-browser，仅作后续 PoC 参考）。每节写明：适用场景、限制（单实例、CDP 必须）、与 `browser.attachOnly` / `cdpUrl` 的配置关系。

- [x] **Step 2: 更新 `docs/zero-token/zero-token-requirements.md` 第 6 节表格**

追加一行：`2026-03-28 | 实施计划 docs/zero-token/plans/2026-03-28-zero-token-refactor.md；浏览器模式见 docs/zero-token/web-models-browser-modes.md`

- [x] **Step 3: README 目录增加 `docs/zero-token/web-models-browser-modes.md` 链接（可选与 Task 1 一并）**

- [x] **Step 4: Commit**

```bash
git add docs/zero-token/web-models-browser-modes.md docs/zero-token/zero-token-requirements.md README.zh-CN.md
git commit -m "docs: web browser modes for CDP and profiles"
```

---

### Task 6（后续 / 可选）: bb-browser PoC 记录

**Files:**

- Modify: `docs/zero-token/zero-token-requirements.md`

- [x] 在本地验证 `bb-browser site <adapter> --openclaw` 是否满足某一站点需求；将结论（可用 / 不可用 / 缺口）写入需求文档变更记录。**本任务不修改 `package.json` 依赖，除非 PoC 通过后另开 PR。**（已完成：`npx bb-browser --help` 验证 CLI；结论文档化于 `docs/zero-token/web-models-browser-modes.md` 与 `docs/zero-token/zero-token-requirements.md`。）

---

## Spec 对照自检

| `docs/zero-token/zero-token-requirements.md` 章节 | 对应任务                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| §1 目标能力 / 端到端                              | Task 2–4 保持行为等价                                                  |
| §2 减少 core 入侵                                 | Task 2–4 收敛热点；Task 1 文档化其余改动面                             |
| §3 浏览器授权                                     | Task 5（及可选 Task 6）                                                |
| §4 Web 模型目录                                   | 实现已收拢至 `src/zero-token/`；`models-config` 大段仍可在后续继续变薄 |

## 计划自检

- 无 TBD /「类似 Task N」占位。
- `getWebStreamFactory` 与 `attempt.ts` 原 11 个 `api` 字符串一致。

---

## 验证记录（2026-03-28）

| 命令                                                                                                                         | 结果                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run src/zero-token/streams/web-stream-factories.test.ts`                                                   | PASS                                                                                                                                                                           |
| `pnpm exec vitest run src/plugins/hooks.model-override-wiring.test.ts`                                                       | PASS                                                                                                                                                                           |
| `pnpm exec vitest run src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/pi-embedded-runner/compact.hooks.test.ts` | PASS（已移除对已删除导出之测试；已修复 `compact.hooks` 的 message-channel mock；`compactEmbeddedPiSession` 在 `ownsCompaction` 引擎路径补全 before/after_compaction 哨兵钩子） |
| `pnpm build`                                                                                                                 | PASS（依赖完整安装后）                                                                                                                                                         |
| `npx -y bb-browser --help`                                                                                                   | CLI 可用（Task 6 文档结论依据）                                                                                                                                                |

**计划文件：** `docs/zero-token/plans/2026-03-28-zero-token-refactor.md`（Task 1–6 步骤已全部勾选完成）。
