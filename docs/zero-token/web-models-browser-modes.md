# Web 模型：浏览器与 CDP 模式说明

本文说明 Zero Token 通过 Playwright **CDP 连接 Chrome** 时的几种用法及硬约束，便于与 `docs/zero-token/zero-token-requirements.md` 对照。

## 模式 A：独立调试 Profile（当前默认）

- **做法**：运行 `start-chrome-debug.sh`，使用专用 `user-data-dir`（如 Linux 下 `~/.config/chrome-openclaw-debug`），并开启 `--remote-debugging-port=9222`。
- **配置**：`browser.attachOnly: true`，`browser.cdpUrl`（或 profile 中的 `cdpUrl`）指向 `http://127.0.0.1:9222`。
- **优点**：不与日常 Chrome 抢同一用户目录；行为稳定、文档与脚本一致。
- **缺点**：需在**该**浏览器实例中完成各站登录，与「日常已登录的 Chrome」不是同一套会话。

## 模式 B：用户自备「单实例」调试 Chrome

- **做法**：用户自行用固定 `user-data-dir` + `--remote-debugging-port` 启动 **唯一** Chrome 进程（例如桌面快捷方式），OpenClaw 仅 **attach** 到该端口。
- **约束**：**同一 `user-data-dir` 不能同时跑两个 Chrome**。若已打开普通 Chrome 占用该目录，再启动调试实例会失败或异常；需关闭其一或使用与日常不同的专用目录。
- **何时算「复用登录态」**：仅当用户**始终**用这一调试实例上网、完成登录，或该目录本就是用户接受的「专用 Zero Token 环境」时，才等价于长期复用会话。

## 模式 C：扩展 / 守护进程桥（参考）

- **参考项目**：[bb-browser](https://github.com/epiral/bb-browser)（扩展 + 本机服务）、[insidebar-ai](https://github.com/xiaolai/insidebar-ai)（侧栏复用站点会话的产品思路）。
- **现状**：本仓库主路径仍为 **CDP + Playwright**；是否引入 bb-browser 类集成以 **PoC 结论** 为准（见下方「bb-browser PoC 摘要」与 `docs/zero-token/zero-token-requirements.md` 变更记录）。
- **说明**：该模式不依赖「无调试端口的普通 Chrome 被 CDP 附加」——需单独实现或集成桥接层。

### bb-browser PoC 摘要（结论性）

| 维度                         | 结论                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 可用性                   | `npx bb-browser --help` 可正常展示命令（`site`、`open`、`eval`、`fetch` 等），适合作为 **独立工具** 或 **MCP** 由 Agent 调用。                                                  |
| 与 Zero Token Web 模型的关系 | bb-browser 以 **站点 adapter**（搜索/热榜/结构化拉数）为主；**不能**替代 `src/zero-token/streams/web-stream-factories.ts` 中 11 个 Web 聊天 Provider 的流式对话与工具协议实现。 |
| `--openclaw`                 | 文档说明可走 OpenClaw 内置浏览器；与 **本 fork 的 CDP 授权 + `*-web-stream`** 是 **并行能力**，非替换关系。                                                                     |
| 推荐用法                     | 需要站外数据时，通过 **工具/MCP** 暴露 `bb-browser`；主对话模型仍走既有 Web Provider。                                                                                          |
| 依赖                         | **本仓库不默认添加** `bb-browser` 依赖；由用户在环境中 `npm i -g bb-browser` 或 `npx` 按需使用。                                                                                |

## 配置关系小结

| 模式 | 典型 `user-data-dir` | CDP 端口 | 与日常 Chrome 并行 |
| ---- | -------------------- | -------- | ------------------ |
| A    | 脚本指定的独立目录   | 9222     | 可以（不同目录）   |
| B    | 用户自选（须单实例） | 用户指定 | 同目录则不可以     |
| C    | 依具体方案           | 依方案   | 依方案             |

授权命令仍通过 `onboard-web-auth` / `auth-choice` 等将凭证写入本地 profile；CDP 只解决「浏览器由谁启动、连哪台 Chrome」。
