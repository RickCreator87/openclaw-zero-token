# Web Models 支持 (Zero-Token)

本文档说明 OpenClaw Web 模型支持的架构设计。

## 概述

OpenClaw Zero-Token 项目支持使用 Web 模型（如 ChatGPT Web、Claude Web、DeepSeek Web 等），通过浏览器会话进行认证，无需 API Key。

## 架构设计

### 目录边界（`src/zero-token/`）

Web 模型实现集中在 **`src/zero-token/`**，与 OpenClaw 核心其它区域分离，便于 fork 与上游同步时审 diff。

```
┌─────────────────────────────────────────────────────────────┐
│ OpenClaw 核心 (与上游同步)                                   │
│ • resolveImplicitProviders() 等（仍含 buildXxxWebProvider）  │
│ • 薄桥接：`src/agents/web-stream-factories.ts` → re-export   │
│ • CLI：`onboard-web-auth` / `auth-choice` → import zero-token │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ src/zero-token/                                              │
│ • providers/ — *-web-client*、*-web-auth                     │
│ • streams/ — *-web-stream.ts、web-stream-factories.ts        │
└─────────────────────────────────────────────────────────────┘
```

### 核心文件

| 文件                                    | 说明                                     |
| --------------------------------------- | ---------------------------------------- |
| `src/zero-token/providers/*.ts`         | 浏览器客户端与 Web 登录辅助              |
| `src/zero-token/streams/*.ts`           | Web 流式工厂与注册表                     |
| `src/agents/web-stream-factories.ts`    | 对 `zero-token/streams` 的稳定 re-export |
| `src/agents/models-config.providers.ts` | 隐式 provider 合并（含 Web 段）          |

### 支持的 Provider

| Provider ID  | 名称                |
| ------------ | ------------------- |
| chatgpt-web  | ChatGPT Web         |
| claude-web   | Claude Web          |
| deepseek-web | DeepSeek Web        |
| doubao-web   | Doubao Web          |
| gemini-web   | Gemini Web          |
| glm-web      | GLM Web (国内)      |
| glm-intl-web | GLM Web (国际)      |
| grok-web     | Grok Web            |
| kimi-web     | Kimi Web            |
| qwen-web     | Qwen Web (阿里国内) |
| qwen-cn-web  | Qwen Web (阿里国际) |
| manus-api    | Manus API           |

## 在聊天里选择 Web 模型（`/model`）

Control UI 聊天框可用 `/model` 切换模型。对 **Claude Web** 建议写全 **provider + 模型 ID**，例如：

```text
/model claude-web/claude-sonnet-4-6
```

这与 `src/zero-token/bridge/web-providers.ts` 中的默认模型 ID 一致；仅写 `/model claude-web` 在部分环境下可能解析不准。其他 Web provider 同理，可用 `/models` 查看完整列表后再 `/model <provider>/<model-id>`。

## 认证流程

### 方式一：webauth 命令

```bash
# 启动 Chrome 调试模式
./start-chrome-debug.sh

# 运行授权命令
pnpm openclaw webauth
```

向导打印「授权完成」或各平台成功信息后，即可结束本次授权。若终端**未返回提示符**，可按 **Ctrl+C** 退出进程（凭证多已在退出前写入；若担心可检查 `auth-profiles.json` / `openclaw.json`）。

### 方式二：onboard 命令

```bash
pnpm openclaw onboard
```

### Chrome 调试模式配置

确保 `~/.openclaw/openclaw.json` 中配置正确的 CDP 端口：

```json
{
  "browser": {
    "enabled": true,
    "attachOnly": true,
    "defaultProfile": "chrome",
    "profiles": {
      "chrome": {
        "cdpPort": 9222,
        "attachOnly": true
      }
    }
  }
}
```

## 与上游同步

1. **上游 OpenClaw**：合并/rebase 时优先处理非 `src/zero-token/` 的冲突。
2. **Zero Token 面**：集中在 `src/zero-token/` 与少量桥接文件（`web-stream-factories` re-export、`onboard-web-auth` import、`models-config` 中 Web 相关段）。

## 故障排除

### Chrome 未找到

运行 `start-chrome-debug.sh` 时如果提示未找到 Chrome，检查：

- Chrome 是否已安装
- 脚本中的路径检测是否覆盖了你的安装位置

### 授权失败 - token expired

如果看到 "Session detected but token expired" 错误，说明浏览器会话存在但 API token 已过期。需要重新登录。

### 端口错误

如果看到 "Failed to resolve Chrome WebSocket URL" 错误，检查：

- 配置文件中的 `cdpPort` 是否与启动的 Chrome 调试端口一致
- Chrome 调试端口默认为 9222

## 开发指南

### 添加新的 Web Provider

1. 在 `src/zero-token/providers/` 增加客户端与 `*-web-auth.ts`
2. 在 `src/zero-token/streams/` 增加 `*-web-stream.ts`，并在 `web-stream-factories.ts` 注册 `model.api`
3. 在 `src/agents/models-config.providers.ts` 增加 `buildXxxWebProvider` 与 `resolveImplicitProviders` 条目（及 `MODEL_APIS` 若需新 `api`）
4. 在 `src/commands/onboard-web-auth.ts`（及按需 `auth-choice.apply.*`）注册登录函数

---

## AskOnce 插件

### 概述

AskOnce 是一个独立插件，提供一次提问获取所有大模型答案的功能。

### 插件结构

```
src/zero-token/extensions/askonce/
├── openclaw.plugin.json
├── package.json
└── src/
    ├── index.ts          # 插件主入口，注册 CLI
    ├── cli.ts            # CLI 命令实现
    └── askonce/          # 核心逻辑
        ├── query-orchestrator.ts
        ├── concurrent-engine.ts
        ├── adapters/      # 模型适配器
        ├── formatters/   # 输出格式化
        ├── types.ts
        ├── constants.ts
        └── index.ts
```

### 使用方式

```bash
# 提问
pnpm openclaw askonce "你的问题"

# 指定模型
pnpm openclaw askonce "你的问题" -m claude-web,deepseek-web

# 列出可用模型
pnpm openclaw askonce --list

# 输出 Markdown
pnpm openclaw askonce "你的问题" -o markdown

# 输出 JSON
pnpm openclaw askonce "你的问题" -o json
```

### 与上游同步

1. **核心代码**：可直接同步，无需修改
2. **AskOnce 插件**：`src/zero-token/extensions/askonce/` 与 Web 实现同树维护
3. **plugin-sdk**：添加新的类型导出需要更新 `src/plugin-sdk/askonce.ts`
