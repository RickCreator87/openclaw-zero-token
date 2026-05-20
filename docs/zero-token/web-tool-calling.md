# Web 模型工具调用原理

## 概述

Web 模型（通过浏览器访问 ChatGPT、DeepSeek、Kimi 等）没有原生的工具调用 API。
OpenClaw Zero Token 通过**提示词注入**让这些模型具备工具调用能力。

基于：

- 论文：[Achieving Tool Calling in LLMs Using Only Prompt Engineering](https://arxiv.org/html/2407.04997v1)（100% 格式正确率）
- 开源项目：[ComfyUI LLM Party](https://github.com/heshengtao/comfyui_LLM_party)（5k+ stars，生产验证）

## 完整流程示例

用户问："帮我看看我桌面上有什么文件"

````
你发消息: "帮我看看我桌面上有什么文件"
          ↓
    ① 中间件拦截（web-stream-middleware.ts）
       - 提取你的消息（13字符）
       - 注入工具定义提示词（~650字符）
       - 拼成完整 prompt 发给模型
          ↓
    ② 通过浏览器发给 DeepSeek web
          ↓
    ③ DeepSeek 回复:
       ```tool_json
       {"tool":"exec","parameters":{"command":"ls -la ~/Desktop"}}
       ```
          ↓
    ④ 中间件用正则提取工具调用
       → 识别出: 工具=exec, 参数=ls -la ~/Desktop
       → 转为 ToolCall 事件给 OpenClaw Agent
          ↓
    ⑤ Agent 在本地机器上执行 ls -la ~/Desktop
       → 得到文件列表
          ↓
    ⑥ 中间件把执行结果反馈给 DeepSeek:
       "Tool exec returned: total 24
        -rw-r--r-- 1 user staff 1024 report.pdf
        -rw-r--r-- 1 user staff 2048 notes.txt ..."
          ↓
    ⑦ DeepSeek 根据结果生成最终回复:
       "您桌面上有以下文件：
        - report.pdf (1KB)
        - notes.txt (2KB) ..."
          ↓
    你看到回复
````

## 提示词模板

注入给模型的提示词约 **780 字符**，包含 3 部分：

### 1. 工具定义（JSON 数组）

```json
[
  { "name": "web_search", "description": "Search web", "parameters": { "query": "string" } },
  { "name": "web_fetch", "description": "Fetch URL", "parameters": { "url": "string" } },
  { "name": "exec", "description": "Run command", "parameters": { "command": "string" } },
  { "name": "read", "description": "Read file", "parameters": { "path": "string" } },
  {
    "name": "write",
    "description": "Write file",
    "parameters": { "path": "string", "content": "string" }
  },
  {
    "name": "message",
    "description": "Send msg",
    "parameters": { "text": "string", "channel": "string" }
  }
]
```

### 2. 格式示例（论文核心：用简单示例教模型）

````
示例: 要给数字5加1，返回:
```tool_json
{"tool":"plus_one","parameters":{"number":"5"}}
````

(plus_one仅为示例，非真实工具)

```

论文指出：**示例教学是 100% 格式正确率的关键**。用一个简单的 `plus_one` 示例教模型输出格式，避免与真实工具混淆。

### 3. 指令

```

你的真实工具见上方列表。需要时只回复tool_json块。不需要则直接回答。

```

## 按模型定制

| 模型 | 模板语言 | 备注 |
|------|---------|------|
| DeepSeek, Doubao, Qwen CN, Kimi, GLM, Xiaomi MiMo | 中文 | 中国模型用中文指令效果更好 |
| ChatGPT | 英文 + 严格模式 | 加 "No extra text" 防止追加说明文字 |
| Claude, Gemini, Grok, Qwen Web, GLM Intl | 英文 | 标准英文模板 |
| Perplexity | 不注入 | 搜索引擎，不支持工具调用 |

## 响应解析

中间件用 3 种正则模式（按优先级）提取工具调用：

1. **Fenced 格式**（最可靠）：
```

```tool_json
{"tool":"web_search","parameters":{"query":"东京天气"}}
```

````

2. **裸 JSON 格式**：
```
{"tool":"exec","parameters":{"command":"date"}}
```

3. **XML 格式**（DeepSeek 兼容）：
```
<tool_call>{"name":"read","arguments":{"path":"/etc/hostname"}}</tool_call>
```

## 工具结果反馈

工具执行后，结果以 user 消息格式反馈给模型：

```
Tool exec returned: 2026年4月5日 星期六 10时03分22秒 CST
Please answer the original question based on this tool result.
```

模型收到结果后生成最终的自然语言回复。

## 架构

```
src/zero-token/tool-calling/
├── web-stream-middleware.ts   # 中间件：包装所有 web stream
├── web-tool-prompt.ts         # 提示词模板（按模型定制）
├── web-tool-parser.ts         # 正则解析工具调用
└── web-tool-defs.ts           # 6 个核心工具定义
```

中间件在 `web-stream-factories.ts` 统一包装所有 web stream factory，
不需要修改任何 stream 文件。

## 已验证模型

| 模型 | 工具调用 | 普通问答 | 备注 |
|------|---------|---------|------|
| DeepSeek | ✅ | ✅ | exec 列桌面文件成功 |
| Kimi | ✅ | ✅ | 6 个工具全部验证通过 |
| Claude | ✅ | ✅ | web_search 成功 |
| ChatGPT | ✅ | ✅ | web_search 成功 |
| Qwen CN | ✅ | ✅ | web_search 成功 |
| Qwen Web | ✅ | ✅ | web_search 成功 |
| Grok | ✅ | ✅ | web_search 成功 |
| Gemini | ✅ | ⚠️ | web_search 触发成功，DOM 抓取偶尔不稳定 |
| Xiaomi MiMo | ✅ | ✅ | web_search 成功 |
| Doubao | ❌ | ⚠️ | 不理解工具提示词，回复有重复 |
| GLM | ✅ | ✅ | 工具调用和普通问答均通过 |
| GLM Intl | ✅ | ✅ | 工具调用和普通问答均通过 |
| Perplexity | — | ✅ | 搜索引擎，不注入工具 |

**11/13 支持工具调用**，2 个不支持（Doubao、Perplexity）。
````
