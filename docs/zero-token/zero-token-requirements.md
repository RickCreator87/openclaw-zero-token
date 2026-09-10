# OpenClaw Zero Token — 产品需求与演进跟踪

> **用途**：固化已确认的目标与约束，便于迭代、评审和与上游 OpenClaw 对齐时对照。  
> **语言**：正文以中文为主；文末附简短 English summary。

| 字段     | 值                                                                                 |
| -------- | ---------------------------------------------------------------------------------- |
| 状态     | 已确认                                                                             |
| 最近更新 | 2026-03-28（实施计划见 `docs/zero-token/plans/2026-03-28-zero-token-refactor.md`） |

---

## 1. 目标能力

- 在 **openclaw-zero-token** 中通过 **各站 Web 版**（如 Claude、ChatGPT、DeepSeek、Gemini、Qwen、Kimi、豆包、GLM、Grok、MiMo 等）使用大模型。
- **不依赖**各平台官方 **API Key** 作为主要路径；通过 **浏览器登录态**（Cookie、Header、页面内请求等）完成对话。
- **端到端**：用户从各渠道向 OpenClaw 发消息后，路由到对应 **Web 模型 Provider**，能稳定取回模型输出（含 **流式**），并由 OpenClaw 按既有链路继续处理（工具、会话、渠道回传等）。

---

## 2. 维护与上游同步策略（核心约束）

- 尽量减少对 **[openclaw/openclaw](https://github.com/openclaw/openclaw) 上游核心 `src/`** 的入侵式修改，避免每次 `merge` / `rebase` 产生大量冲突。
- **优先**将 Zero Token 特有逻辑放在：
  - **`extensions/*` 插件**（例如已存在的 Web 模型注册与扩展包），以及
  - **配置**（如 `openclaw.json` / 环境约定）、**脚本与文档**。
- 与「用 [CLI-Anything](https://github.com/HKUDS/CLI-Anything) 把 OpenClaw 做成 API」的表述对齐后的结论：
  - CLI-Anything 更适合为**带源码的桌面/应用**生成 Python CLI，**不宜**作为把 OpenClaw HTTP 化或替代 Gateway 的主方案。
  - 所谓「API」在本项目中的含义应为：**稳定、可集成的调用面** — 现有 **CLI**、**Gateway WebSocket**，以及将来按需增加的 **薄 HTTP 适配层**，而非必须用 CLI-Anything 重包一层。

---

## 3. 浏览器授权与登录态复用

### 3.1 当前基线

- 使用 **`start-chrome-debug.sh`** 启动带 **`--remote-debugging-port`** 的 Chrome，并配合 **独立 `user-data-dir`**（与日常浏览器隔离）。
- 配置 **`browser.attachOnly`** + **`cdpUrl`**，由 **`src/providers/*-web-auth.ts`** / **`*-web-client-browser.ts`** 通过 **Playwright `connectOverCDP`** 连接并抓取凭证或驱动页面。

### 3.2 优化方向（产品目标）

- 在**技术可行且安全可控**的前提下，向 **「复用用户真实浏览器的登录态」** 靠拢，减少「必须单独开一套调试浏览器」的摩擦。
- **参考思路**（非强制绑定某一实现）：
  - [bb-browser](https://github.com/epiral/bb-browser)：扩展 + 本机通道、OpenClaw 集成模式等。
  - [insidebar-ai](https://github.com/xiaolai/insidebar-ai)：在已有登录会话的浏览环境中使用各站（产品层面的「会话在浏览器里」）。

### 3.3 必须遵守的技术约束（避免错误预期）

- **同一 Chrome `user-data-dir` 不能同时跑两个浏览器实例**；若用户日常已打开「普通 Chrome」，再启动同目录的调试实例通常会失败或行为未定义。
- **未以调试方式启动的 Chrome 无法被 CDP 附加**；「无端口、无扩展桥」则无法 magically 读取另一进程的登录态。
- 可选路径需在文档与实现中写清：**专用调试快捷方式（单实例）**、**独立 Profile（现状）**、**扩展/守护进程桥接** 等及其取舍。

---

## 4. 架构对齐（与当前仓库）

- **Web 模型实现**集中在 **`src/zero-token/`**（`providers/` 站点客户端与登录辅助，`streams/` 流式工厂与 `web-stream-factories.ts`）。Core 仅保留薄桥接（如 `src/agents/web-stream-factories.ts` re-export、`models-config` 与 CLI 的 import 路径）。
- 演进方向：在保持 **OpenClaw Provider 管道**不变的前提下，继续把 **与上游易冲突的改动**限制在 `src/zero-token/` 与少数桥接文件，便于 rebase。

---

## 5. 非目标（当前阶段不承诺）

- 不承诺用 CLI-Anything 作为官方主集成方式。
- 不承诺 bb-browser 的站点适配器 **单独**覆盖所有 Web 模型站点的完整对话能力；是否引入、引入范围以 **PoC 与维护成本** 为准。
- 不承诺突破各平台服务条款或反自动化策略；实现以 **合规、用户自担风险** 为前提（参见主 README 免责声明）。

---

## 6. 变更记录

| 日期       | 说明                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-28 | 初稿：与用户确认的五点需求（Web 模型免 API Key、插件化减 fork 冲突、浏览器登录态优化、调用面定义、端到端链路）                                                                                                                                                                                                                                                      |
| 2026-03-28 | Superpowers 实施计划：`docs/zero-token/plans/2026-03-28-zero-token-refactor.md`；浏览器模式说明：`docs/zero-token/web-models-browser-modes.md`；上游同步清单：`docs/zero-token/upstream-sync.md`；Web 流式注册表在 `src/zero-token/streams/web-stream-factories.ts`（`src/agents/web-stream-factories.ts` 为 re-export）                                            |
| 2026-03-28 | **bb-browser PoC（文档结论）**：CLI 可用；适配器面向站外结构化数据，**不**替代 11 个 Web 聊天 Provider；摘要见 `docs/zero-token/web-models-browser-modes.md`「bb-browser PoC 摘要」；不默认加入 `package.json` 依赖。                                                                                                                                               |
| 2026-03-28 | 计划收尾：README「与上游同步」链至 `docs/zero-token/upstream-sync.md`；`hooks.model-override-wiring` 通过；修复 `compact.hooks.test.ts` 的 `INTERNAL_MESSAGE_CHANNEL` mock；移除 `attempt.test.ts` 中对已删除之 `wrapStreamFnRepairMalformedToolCallArguments` 的用例。                                                                                             |
| 2026-03-28 | `compactEmbeddedPiSession`：当 `contextEngine.info.ownsCompaction` 为真时，在调用 `contextEngine.compact` 前后触发 `before_compaction` / `after_compaction`（`messageCount`/`compactedCount` 哨兵为 `-1`，与 `compact.hooks.test.ts` 约定一致）。                                                                                                                   |
| 2026-03-28 | **目录收拢**：Web 模型实现迁至 **`src/zero-token/providers/`** 与 **`src/zero-token/streams/`**；`src/agents/web-stream-factories.ts` 仅为 re-export；移除冗余 **`extensions/web-models`** 与 **`src/plugin-sdk/web-models.ts`**；`extensions/askonce` 适配器改为引用仓库内 `src/zero-token/streams/*`。                                                            |
| 2026-03-28 | **AskOnce**：插件目录迁至 **`src/zero-token/extensions/askonce/`**；`resolveBundledPluginSearchDirs` 同时扫描 `extensions/` 与 **`src/zero-token/extensions/`**。                                                                                                                                                                                                   |
| 2026-03-28 | **`models-config` 抽桥**：Web 常量、`discover*WebModels`、`build*WebProvider` 迁至 **`src/zero-token/bridge/web-providers.ts`**；`models-config.providers.ts` 负责 import、`resolveImplicitProviders` 合并，并 **re-export** 原符号以保持 `onboard-auth.config-core` 等既有 import 路径不变。                                                                       |
| 2026-03-28 | **补齐 Web 接线**：`perplexity-web` / `qwen-cn-web` 注册进 **`web-stream-factories`** 与 **`resolveImplicitProviders`**；新增 **`buildPerplexityWebProvider`**；`glm-intl-web` 与其它 Web 渠道同为无条件合并；**`docs/zero-token/upstream-sync.md`** 与当前目录对齐；**`release-check`** 对捆绑扩展按 id 去重；**`discovery`** 注释说明 bundled 扫描会 chmod 目录。 |
| 2026-03-28 | **文档目录**：Zero Token 专用说明收拢至 **`docs/zero-token/`**（索引见 `docs/zero-token/index.md`）；原 `docs/` 根路径同名页在 Mintlify 增加 **redirect** 至新路径。                                                                                                                                                                                                |

_后续优化（例如选定「调试 Chrome / 扩展桥」最终方案、迁移某 Provider 出 core）请在本表追加一行。_

---

## English summary

**Zero Token** uses web UIs and browser session (cookies, etc.) instead of paid API keys. **Minimize invasive changes** to upstream OpenClaw core; prefer **`extensions/*`** and config. **Improve auth UX** toward reusing real browser login where technically possible, respecting Chrome profile / CDP constraints. **Stable integration surface** = CLI + Gateway WS (optional thin HTTP later); **not** CLI-Anything as the primary “API” strategy. **End-to-end**: messages route to web providers, streaming replies return through normal OpenClaw handling.
