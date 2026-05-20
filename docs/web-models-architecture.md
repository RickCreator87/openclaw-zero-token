# Web 模型架构文档

## 概述

Web 模型（又称 "Zero Token" 模型）是指通过浏览器 Cookie/Session 认证而非 API Key 调用的大模型服务。代表：DeepSeek Web、Claude Web、ChatGPT Web 等。

## 核心设计原则

1. **非插件架构**：Web 模型不是 OpenClaw Plugin，不走 `ProviderPlugin.createStreamFn()` 插件体系
2. **独立 Stream 工厂**：每个 web provider 有独立的 `createXXXWebStreamFn` 工厂函数
3. **凭证独立存储**：Cookie/Session 存储在 `auth-profiles.json`，不经过 OpenClaw upstream config
4. **白名单门控**：用户可见性由 `agents.defaults.models` 白名单控制

## 授权流程

```
用户执行 onboard-web-auth 命令
  │
  ├─► Wizard 展示 13 个可选 Web 模型
  │     └─► WEB_MODEL_PROVIDERS 列表定义各模型的 loginFn
  │
  ├─► 调用 provider.loginFn()
  │     └─► 各 provider 的 login 函数 (loginDeepseekWeb 等)
  │           ├─► 打开浏览器登录页 (Puppeteer/手动)
  │           └─► 提取 cookies / session token
  │
  ├─► 保存凭证到 auth-profiles.json
  │     路径: {OPENCLAW_STATE_DIR}/auth-profiles.json
  │     格式: { profiles: { "deepseek-web:default": { type: "token", token: "..." } } }
  │
  └─► 添加模型到白名单
        openclaw.json: agents.defaults.models: { "deepseek-web/deepseek-chat": { alias: "DeepSeek V3" } }
```

## 模型目录加载流程

模型出现在 UI 的模型列表中，需要经过以下链路：

```
loadModelCatalog()
  │
  ├─1─► pi-sdk ModelRegistry
  │     读取 agentDir/models.json
  │     仅包含 upstream 支持的模型（不含 web 模型）
  │
  ├─2─► mergeConfiguredOptInProviderModels()
  │     读取 models.providers
  │     NON_PI_NATIVE_MODEL_PROVIDERS = {deepseek, kilocode}
  │     ⚠️ 不读取 agents.defaults.models 白名单
  │
  ├─3─► mergeWhitelistedWebModels()  ← ZERO TOKEN 新增
  │     读取 agents.defaults.models 白名单
  │     对每个 "provider/modelId" 格式的条目：
  │       ├─► 若 provider 是 isWebProvider() → 合成 ModelCatalogEntry
  │       └─► 从 KNOWN_WEB_MODEL_ENTRIES 查找 metadata
  │
  └─4─► augmentModelCatalogWithProviderPlugins()
        读取插件提供的模型（web 模型不在此）
```

## 消息发送流程（核心链路）

```
用户选择 deepseek-web/deepseek-chat，发消息
  │
  ▼
resolveConfiguredModelRef(cfg, "deepseek-web/deepseek-chat")
  ├─► 查 agents.defaults.models 白名单 ✓ (alias: "DeepSeek V3")
  └─► 查 models.providers → 找到 baseUrl=https://chat.deepseek.com
  → 返回 ModelRef { provider, modelId, baseUrl }

  ▼
attempt.ts: resolveEmbeddedAgentStreamFn()
  ├─► registerProviderStreamForModel({ model, cfg, agentDir })
  │     ├─► resolveProviderStreamFn(provider) → 插件系统 → undefined (web 模型非插件)
  │     │
  │     └─► 走 fallback 分支:
  │           ├─► getWebStreamFactory(model.api) → "deepseek-web"
  │           │     └─► 映射表 web-stream-factories.ts
  │           │           → createDeepseekWebStreamFn ✓
  │           ├─► 从 auth-profiles.json 读取凭证
  │           │     └─► "deepseek-web:default" → { type:"token", token:"..." }
  │           └─► 调用 createDeepseekWebStreamFn(credential) → StreamFn
  │
  ▼
StreamFn(model, context) 被调用
  ├─► DeepSeekWebClient.init() — 用 cookie 初始化 HTTP client
  ├─► client.createChatSession() — 创建服务端会话 → 拿到 sessionId
  ├─► client.sendMessage(sessionId, prompt) — 发送消息
  │     └─► 返回 SSE 流 (Server-Sent Events)
  └─► 将 SSE 转换为 pi-ai AssistantMessageEvent 格式
        ├─► thinking event (思考过程)
        ├─► text event (回复文本)
        └─► tool_result event (工具调用结果)

  ▼
attempt.ts 处理事件 → 转发给前端 WebSocket
  ▼
Web UI 渲染回复
```

## 关键文件清单

| 文件                                             | 职责                                           |
| ------------------------------------------------ | ---------------------------------------------- |
| `src/zero-token/providers/*-web-auth.ts`         | 各模型的 login 函数（获取 cookie）             |
| `src/agents/auth-profiles.ts`                    | 凭证读写（auth-profiles.json）                 |
| `src/zero-token/streams/*-web-stream.ts`         | 各模型的 StreamFn 实现                         |
| `src/zero-token/streams/web-stream-factories.ts` | model.api → StreamFn 工厂的映射表              |
| `src/agents/web-stream-factories.ts`             | 桥接模块（稳定 import 路径）                   |
| `src/agents/provider-stream.ts`                  | 核心：resolveProviderStreamFn + fallback       |
| `src/agents/model-catalog.ts`                    | `mergeWhitelistedWebModels()` 将白名单注入目录 |
| `src/commands/onboard-web-auth.ts`               | CLI 授权向导                                   |

## 本地工程适配情况

### 已修复 ✅

1. **`provider-stream.ts`** — 添加了 fallback 分支，从 `getWebStreamFactory()` + auth-profiles 获取 web 模型 StreamFn
2. **`web-stream-factories.ts`** — 桥接模块已存在
3. **`model-catalog.ts`** — 添加了 `KNOWN_WEB_PROVIDER_IDS`、`isWebProvider()`、`mergeWhitelistedWebModels()`
4. **配置** — 从 `models.providers` 移除了无效 api 类型的 web provider 条目（避免 schema 报错）

### 依赖前提 ✅

1. **auth-profiles.json** — 各 web provider 的凭证（`type: "token"`）
2. **openclaw.json** — `agents.defaults.models` 白名单包含 web 模型
3. **web-stream-factories.ts** — 所有 13 个 provider 的工厂函数已注册

### 验证结果

```
stage=registry-read entries=781          ← pi-sdk 原生模型
stage=configured-models-merged entries=779  ← 过滤 deepseek (NON_PI_NATIVE)
stage=whitelisted-web-models-merged entries=796  ← +17 web 模型
stage=plugin-models-merged entries=798
stage=complete entries=798
```

## 注意事项

1. **不要在 models.providers 中注册 web provider** — schema 验证会拒绝无效的 `api` 值
2. **避免频繁发消息** — web 模型使用真实账号，频繁请求可能导致账号被封
3. **StreamFn 的 fallback** — 这是 zero-token 核心机制，plugin 系统对 web 模型不可见
4. **session 复用** — deepseek-web-stream 等使用 `sessionMap` 复用 chat session，避免创建过多会话
