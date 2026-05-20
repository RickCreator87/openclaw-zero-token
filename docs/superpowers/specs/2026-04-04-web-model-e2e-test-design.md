# Web Model End-to-End Test Design

## Overview

A fully automated end-to-end test suite for all 13 zero-token web model providers.
Covers 3 test layers (L2 HTTP API, L3 WebSocket, L5 Browser UI) with anti-ban
protection, natural message pools, and HTML report output.

**Entry point**: `bash scripts/test-web-model-e2e.sh`

## Architecture

```
test-web-model-e2e.sh (shell orchestrator)
  |-- Phase 0: Prerequisites (node, jq, config)
  |-- Phase 1: Build (pnpm build)
  |-- Phase 1.5: Unit tests (vitest)
  |-- Phase 2: Chrome debug launch
  |-- Phase 3: Auth check (auth-profiles.json)
  |-- Phase 4: Gateway start + healthz
  |-- Phase 5+: node --import tsx scripts/test-web-e2e-runner.ts
        |-- L2: HTTP API smoke (POST /v1/chat/completions)
        |-- L3: WebSocket protocol (connect + chat.send + events)
        |-- L5: Playwright browser UI (open page, select model, type, send, read reply)
        |-- Anti-ban: adaptive delays + provider interleaving
        |-- Message pool: random selection, CN/EN split
        |-- Output: terminal live + HTML report
```

## Path Isolation

All paths are zero-token specific, never shared with system openclaw:

| Resource         | Path                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| Config           | `.openclaw-upstream-state/openclaw.json`                                   |
| Auth             | `.openclaw-upstream-state/agents/main/agent/auth-profiles.json`            |
| Gateway port     | 3001 (env `ZT_GATEWAY_PORT`)                                               |
| Chrome CDP port  | 9222 (env `ZT_CHROME_PORT`)                                                |
| State dir        | `.openclaw-upstream-state/`                                                |
| Chrome user data | `~/Library/.../Chrome-OpenClaw-Debug` or `~/.config/chrome-openclaw-debug` |
| Reports          | `reports/web-model-e2e-{timestamp}.html`                                   |

## Web Model Registry (13 providers)

| Provider       | Default Model     | Language | Base URL                |
| -------------- | ----------------- | -------- | ----------------------- |
| claude-web     | claude-sonnet-4-6 | EN       | claude.ai               |
| chatgpt-web    | gpt-4             | EN       | chatgpt.com             |
| deepseek-web   | deepseek-chat     | CN       | chat.deepseek.com       |
| doubao-web     | doubao-seed-2.0   | CN       | doubao.com              |
| qwen-web       | qwen3.5-plus      | CN       | chat.qwen.ai            |
| qwen-cn-web    | Qwen3.5-Plus      | CN       | chat2.qianwen.com       |
| kimi-web       | moonshot-v1-32k   | CN       | kimi.com                |
| gemini-web     | gemini-pro        | EN       | gemini.google.com       |
| grok-web       | grok-2            | EN       | grok.com                |
| glm-web        | glm-4-plus        | CN       | chatglm.cn              |
| glm-intl-web   | glm-4-plus        | EN       | chat.z.ai               |
| perplexity-web | perplexity-web    | EN       | perplexity.ai           |
| xiaomimo-web   | xiaomimo-chat     | CN       | aistudio.xiaomimimo.com |

## Message Pool Design

20 messages total (10 CN, 10 EN), simulating natural user conversations.
Each test run picks randomly without repetition within a single run.

**Chinese pool (for CN providers)**:

1. "请帮我用简单的语言解释一下什么是量子计算"
2. "写一首关于春天的五言绝句"
3. "北京有哪些适合周末去的公园？推荐三个"
4. "帮我把这段话改得更正式一些：我觉得这个方案还行"
5. "简单介绍一下光合作用的过程"
6. "推荐三本适合初学者的Python编程书籍"
7. "中国传统节日春节有哪些习俗？简要说明"
8. "请解释一下TCP和UDP的主要区别"
9. "帮我写一段面试自我介绍，要求简洁有力"
10. "描述一下你理解的人工智能的发展趋势"

**English pool (for EN providers)**:

1. "Explain the concept of machine learning in simple terms"
2. "Write a short poem about the ocean"
3. "What are three tips for improving public speaking skills?"
4. "Briefly describe how photosynthesis works"
5. "What are the key differences between Python and JavaScript?"
6. "Recommend three classic science fiction novels"
7. "Explain the difference between REST and GraphQL APIs"
8. "Write a brief motivational message for someone starting a new job"
9. "What are the main causes of climate change?"
10. "Describe the basics of how blockchain technology works"

**Selection criteria**: short (under 50 chars where possible), natural tone,
non-sensitive topics, expect concise replies (under 500 chars).

## Anti-Ban Strategy

### Adaptive Delay

```
baseDelay = 15s
currentDelay = baseDelay

on success:
  currentDelay = max(baseDelay * 0.5, currentDelay * 0.7)

on rate-limit (HTTP 429 / timeout / captcha):
  currentDelay = min(120s, currentDelay * 2)
  skip current model, retry at end of queue

between providers:
  sleep(currentDelay + random(0, 5s))  // jitter to avoid patterns
```

### Provider Interleaving

Models are sorted to maximize distance between same-family providers:

```
Round-robin by region/family:
  CN-1, EN-1, CN-2, EN-2, ...
Never test same base URL consecutively.
```

### Request Fingerprint Variation

- Randomize User-Agent minor version in HTTP headers
- Vary message content (pool random selection)
- Add small random jitter to request timing

## Test Layer Details

### L2: HTTP API Smoke

For each authorized model, send `POST /v1/chat/completions`:

```json
{
  "model": "provider/model-id",
  "messages": [{ "role": "user", "content": "<pool message>" }],
  "stream": false
}
```

**Validations**:

- HTTP 200
- Valid JSON response
- `choices[0].message.content` non-empty
- `choices[0].message.role` === "assistant"
- Content length > 1 char and < 10000 chars (sanity bounds)
- Response time < ZT_TIMEOUT (default 120s)

### L3: WebSocket Protocol

Connect to `ws://127.0.0.1:{port}/` and execute the gateway protocol:

1. Wait for `connect.challenge` event (extract nonce)
2. Send `connect` request with auth token + protocol version 3
3. Wait for `hello-ok` response
4. Send `models.list` request, verify model exists in catalog
5. Send `chat.send` with message, sessionKey, idempotencyKey
6. Collect `chat.delta` events until `chat.final` received
7. Validate final message content non-empty and well-formed

**Validations**:

- Connection established within 5s
- `hello-ok` received with valid server info
- Target model present in `models.list` response
- `chat.final` received within ZT_TIMEOUT
- Accumulated delta text matches final message content
- No `chat.error` events

### L5: Playwright Browser UI

Using Playwright (already a project dependency), automate the Control UI:

1. Navigate to `http://127.0.0.1:{port}/#token={gateway_token}`
2. Wait for WebSocket connection (check for chat UI ready state)
3. Locate model selector (dropdown/sidebar), select target model
4. Find chat input (textarea/contenteditable), type message
5. Click send button or press Enter
6. Wait for assistant reply to render (poll DOM for response bubble)
7. Extract reply text, validate non-empty and reasonable length

**Validations**:

- Page loads within 10s
- Model selector found and model selectable
- Input field found and accepts text
- Send triggers response
- Reply appears within ZT_TIMEOUT
- Reply text is non-empty and < 10000 chars

**DOM Strategy** (resilient to UI changes):

- Use multiple selector fallbacks (data attributes > aria labels > class patterns)
- Wait for network idle + DOM stable before assertions
- Screenshot on failure for debugging

## HTML Report

Generated to `reports/web-model-e2e-{timestamp}.html`.

**Sections**:

1. **Summary header**: total/pass/fail counts, duration, timestamp
2. **Per-model cards**: model name, L2/L3/L5 status badges, response time, reply preview (truncated), error details if failed
3. **Environment info**: Node version, gateway port, Chrome port, config paths
4. **Anti-ban stats**: delays used, retries, rate-limit events

**Styling**: self-contained HTML (inline CSS), no external dependencies.
Color coding: green (pass), red (fail), yellow (skipped/warning).

## File Structure

```
scripts/
  test-web-model-e2e.sh          # Shell orchestrator (existing, to be updated)
  test-web-e2e-runner.ts          # Main TypeScript runner (new)
  lib/
    e2e-message-pool.ts           # Message pool with CN/EN split (new)
    e2e-anti-ban.ts               # Adaptive delay + interleaving (new)
    e2e-test-l2-http.ts           # L2 HTTP API tests (new)
    e2e-test-l3-ws.ts             # L3 WebSocket tests (new)
    e2e-test-l5-ui.ts             # L5 Playwright UI tests (new)
    e2e-html-report.ts            # HTML report generator (new)
reports/                          # Generated reports (gitignored)
```

## CLI Interface

```bash
# Full flow
bash scripts/test-web-model-e2e.sh

# Skip build/auth/browser
bash scripts/test-web-model-e2e.sh --skip-build --skip-auth --skip-browser

# Test specific models only
bash scripts/test-web-model-e2e.sh --models "qwen-cn-web/Qwen3.5-Plus,kimi-web/moonshot-v1-32k"

# Skip specific layers
bash scripts/test-web-model-e2e.sh --skip-l5  # skip browser UI tests
bash scripts/test-web-model-e2e.sh --skip-l3  # skip WebSocket tests

# Custom delay
ZT_BASE_DELAY=30 bash scripts/test-web-model-e2e.sh

# Keep gateway running after test
bash scripts/test-web-model-e2e.sh --no-cleanup
```

## Environment Variables

| Variable        | Default | Description                         |
| --------------- | ------- | ----------------------------------- |
| ZT_GATEWAY_PORT | 3001    | Gateway port                        |
| ZT_CHROME_PORT  | 9222    | Chrome CDP port                     |
| ZT_TIMEOUT      | 120     | Per-model timeout (seconds)         |
| ZT_BASE_DELAY   | 15      | Base delay between models (seconds) |
| ZT_MAX_DELAY    | 120     | Max backoff delay (seconds)         |
| ZT_REPORT_DIR   | reports | HTML report output directory        |

## Error Handling

- **Model not authorized**: skip with "skipped" status, no failure
- **Rate limited (429)**: backoff, retry once at end of queue
- **Timeout**: mark as fail, continue to next model
- **Gateway down**: abort entire test run
- **Playwright element not found**: screenshot, mark L5 as fail, L2/L3 results preserved
- **WebSocket connection refused**: mark L3 as fail, continue L2/L5
