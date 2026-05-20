# Zero Token（fork 文档）

本目录收录 **openclaw-zero-token** 相对上游 OpenClaw 的产品说明、同步清单与 Web 模型文档；与实现代码树 **`src/zero-token/`** 配套阅读。

| 文档                                                                        | 说明                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| [需求与演进跟踪](/zero-token/zero-token-requirements)                       | 目标、约束、变更记录（中文为主）                         |
| [与上游同步](/zero-token/upstream-sync)                                     | merge/rebase 时的改动面清单与步骤                        |
| [Web 模型支持](/zero-token/web-models-support)                              | 架构、Provider 列表、开发与 AskOnce                      |
| [Web 模型工具调用](/zero-token/web-tool-calling)                            | 提示词注入原理、完整流程、模板、验证结果                 |
| [浏览器与 CDP 模式](/zero-token/web-models-browser-modes)                   | 调试 Chrome、Profile、bb-browser 参考                    |
| [Web 模型测试流程](/zero-token/web-model-test-flow)                         | 离线单测、HTTP 矩阵/活测、CLI+chat.send E2E、手测与排障  |
| [Web 模型测试报告（用例/分层/逐模型表）](/zero-token/WEB_MODEL_TEST_REPORT) | 「通过」的精确定义、用例编号、逐 provider 状态与证据要求 |
| [重构实施计划](/zero-token/plans/2026-03-28-zero-token-refactor)            | 历史实施计划与验证记录                                   |

GitHub 上也可直接打开：`docs/zero-token/` 下对应 `.md` 文件。
