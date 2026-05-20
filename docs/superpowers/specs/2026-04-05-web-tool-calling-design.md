# Web Model Tool Calling via Prompt Engineering

## Overview

Enable tool calling for web models that don't have native function calling APIs,
using prompt injection to instruct models to return structured JSON tool calls.

Based on:

- Paper: [Achieving Tool Calling in LLMs Using Only Prompt Engineering](https://arxiv.org/html/2407.04997v1) — 100% format success rate
- Project: [ComfyUI LLM Party](https://github.com/heshengtao/comfyui_LLM_party) (5k+ stars) — production validated

## Architecture

A unified middleware wraps all web stream functions, handling input rewriting
and output parsing in one place. Individual stream files are not modified.

```
Agent Runner → StreamFn(model, context, options)
                ↓
        web-stream-middleware.ts
          ├── Input: extract user msg → strip metadata → inject tool prompt
          ├── Delegate: call original web stream
          └── Output: regex-extract tool_call → emit ToolCall events
                ↓
        Original web stream (unchanged)
```

## File Structure

```
src/zero-token/tool-calling/
  web-tool-defs.ts          # 6 core tool definitions
  web-tool-prompt.ts        # Per-model prompt templates
  web-tool-parser.ts        # Regex extraction of tool calls from response
  web-stream-middleware.ts   # Middleware: wraps StreamFn
```

## Supported Models

Tool calling prompt injection is applied to **DOM-simulation models** only:

| Model       | Template  | Tool Call  | Result Feedback | Status                   |
| ----------- | --------- | ---------- | --------------- | ------------------------ |
| Kimi        | CN        | web_search | 实时天气        | PASS                     |
| ChatGPT     | EN strict | web_search | 天气数据        | PASS                     |
| Gemini      | EN        | web_search | 触发成功        | PASS                     |
| Grok        | EN        | web_search | 实时天气        | PASS                     |
| Qwen CN     | CN        | web_search | 18°C 阴天       | PASS                     |
| Qwen Web    | EN        | web_search | 天气数据        | PASS                     |
| Doubao      | CN        | web_search | 天气数据        | PASS                     |
| Xiaomi MiMo | CN        | web_search | 实时天气        | PASS                     |
| Perplexity  | —         | —          | —               | Excluded (search engine) |

**Not wrapped** (these use raw API with native tool calling):

- claude-web, deepseek-web, glm-web — upstream handles tools natively

## Tool Definitions (6 core tools)

```json
[
  {
    "name": "web_search",
    "description": "Search the web",
    "parameters": { "query": "search query" }
  },
  {
    "name": "web_fetch",
    "description": "Fetch URL content",
    "parameters": { "url": "URL to fetch" }
  },
  {
    "name": "exec",
    "description": "Run shell command",
    "parameters": { "command": "shell command" }
  },
  { "name": "read", "description": "Read file contents", "parameters": { "path": "file path" } },
  {
    "name": "write",
    "description": "Write to file",
    "parameters": { "path": "file path", "content": "file content" }
  },
  {
    "name": "message",
    "description": "Send message to channel",
    "parameters": { "text": "message", "channel": "channel name" }
  }
]
```

Total prompt overhead: ~350 characters.

## Prompt Template

```
You have these tools:
[tools JSON array]

To use a tool, reply ONLY with:
` ` `tool_json
{"tool":"name","parameters":{"key":"value"}}
` ` `
If no tool needed, answer directly.

[user message]
```

### Per-Model Customizations

- **ChatGPT**: append "Do not add any text after the JSON block"
- **Chinese models** (Doubao, Qwen CN, Kimi, Xiaomi): use Chinese instruction
- **Others**: use default English template

## Response Parsing

Three regex patterns tried in order:

1. Fenced: ` ```tool_json\n{...}\n``` `
2. Bare JSON: `{"tool":"...","parameters":{...}}`
3. XML (DeepSeek compat): `<tool_call>...</tool_call>`

Extraction logic:

```typescript
function extractToolCall(
  text: string,
): { tool: string; parameters: Record<string, unknown> } | null;
```

## Tool Result Feedback

When a tool call is extracted and executed, the result is sent back as a
follow-up user message:

```
Tool [tool_name] returned: [result]
Please continue answering based on this result.
```

This follows the ComfyUI LLM Party approach (user-role feedback for
interfaces that don't support observation role).

## Middleware Implementation

```typescript
export function wrapWithToolCalling(streamFn: StreamFn, api: string): StreamFn {
  // Skip models with native tool calling
  if (NATIVE_TOOL_MODELS.has(api)) return streamFn;
  // Skip search engines
  if (EXCLUDED_MODELS.has(api)) return streamFn;

  return (model, context, options) => {
    // 1. Extract last user message
    // 2. Strip inbound metadata
    // 3. Prepend tool prompt (if context.tools has tools)
    // 4. Call original stream
    // 5. Parse response for tool calls
    // 6. If tool call found: emit toolcall events
    // 7. If no tool call: emit text events as-is
  };
}
```

## Integration Point

`web-stream-factories.ts`:

```typescript
export function getWebStreamFactory(api: string) {
  const factory = WEB_STREAM_FACTORIES[api];
  if (!factory) return undefined;
  return (cookie: string) => wrapWithToolCalling(factory(cookie), api);
}
```

## Testing

Manual verification with real web models:

- Send "What is the weather in Beijing?" → expect tool_call for web_search
- Send "What is 2+2?" → expect direct answer (no tool call)
- Send "Read the file /etc/hostname" → expect tool_call for read
