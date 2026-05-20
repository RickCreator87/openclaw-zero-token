#!/usr/bin/env bash
# 国内 qwen-cn-web 完整自动化链路：选模型（请求体 / RPC 显式 model）→ 发消息 → 校验非空回复。
# L1：Vitest（web stream 注册等）
# L2：POST /v1/chat/completions，model=qwen-cn-web/Qwen3.5-Plus
# L3：openclaw agent --model qwen-cn-web/Qwen3.5-Plus（与本回合「选模型」对齐）
#
# 前置：Gateway 已启动；qwen-cn-web 已 onboard；需 jq（L2/L3 校验）。
# 环境变量：
#   WEB_MODEL_TEST_URL、WEB_MODEL_TEST_TOKEN（必填）
#   WEB_MODEL_TEST_PROMPT（可选）
#   WEB_MODEL_TEST_QWEN_CN_MODEL（可选，默认 qwen-cn-web/Qwen3.5-Plus）
#
# 说明：WebSocket chat.send（L4）无 per-request model，本会话脚本不跑 L4；
# 若要与 Control UI 完全一致，见 docs/zero-token/WEB_MODEL_TEST_REPORT.md §L4/L5。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QWEN_MODEL="${WEB_MODEL_TEST_QWEN_CN_MODEL:-qwen-cn-web/Qwen3.5-Plus}"
export WEB_MODEL_TEST_PROMPT="${WEB_MODEL_TEST_PROMPT:-用一句话回答：1+1等于几？只输出数字和符号。}"

echo "==> [L1] Zero Token web stream 单元测试"
pnpm exec vitest run --config scripts/vitest.zero-token-web.config.ts

: "${WEB_MODEL_TEST_URL:?设置 WEB_MODEL_TEST_URL，如 http://127.0.0.1:3001}"
: "${WEB_MODEL_TEST_TOKEN:?设置 WEB_MODEL_TEST_TOKEN（网关 Bearer）}"

BASE="${WEB_MODEL_TEST_URL%/}"

echo ""
echo "==> [健康检查] GET ${BASE}/healthz"
code="$(curl -sS -o /tmp/openclaw-healthz.json -w "%{http_code}" "${BASE}/healthz" || true)"
if [[ "$code" != "200" ]]; then
  echo "healthz HTTP $code，尝试 /health"
  code="$(curl -sS -o /tmp/openclaw-healthz.json -w "%{http_code}" "${BASE}/health" || true)"
fi
if [[ "$code" != "200" ]]; then
  echo "网关健康检查失败 (last http=$code)" >&2
  cat /tmp/openclaw-healthz.json 2>/dev/null || true
  exit 1
fi
echo "health OK (http=$code)"

if ! command -v jq >/dev/null 2>&1; then
  echo "需要 jq 以校验 L2/L3 回复正文" >&2
  exit 1
fi

BODY="$(MODEL_JSON="$QWEN_MODEL" PROMPT_JSON="$WEB_MODEL_TEST_PROMPT" node -e '
const model = process.env.MODEL_JSON;
const prompt = process.env.PROMPT_JSON;
console.log(JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false }));
')"

echo ""
echo "==> [L2] POST ${BASE}/v1/chat/completions model=${QWEN_MODEL}"
resp_code="$(curl -sS -o /tmp/openclaw-chat-qwen-cn.json -w "%{http_code}" \
  -X POST "${BASE}/v1/chat/completions" \
  -H "Authorization: Bearer ${WEB_MODEL_TEST_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY")"

echo "HTTP $resp_code"
if [[ "$resp_code" != "200" ]]; then
  head -c 2000 /tmp/openclaw-chat-qwen-cn.json >&2 || true
  echo >&2
  exit 1
fi

content="$(jq -r '.choices[0].message.content // empty' /tmp/openclaw-chat-qwen-cn.json)"
if [[ -z "${content// }" ]]; then
  echo "L2：响应 200 但 choices[0].message.content 为空" >&2
  head -c 1500 /tmp/openclaw-chat-qwen-cn.json >&2
  echo >&2
  exit 1
fi
echo "L2 助手回复（节选）: ${content:0:200}$([[ ${#content} -gt 200 ]] && echo ...)"

echo ""
echo "==> [L3] openclaw agent --model ${QWEN_MODEL}"
AGENT_OUT="$(mktemp)"
node openclaw.mjs agent --agent main --model "$QWEN_MODEL" --message "$WEB_MODEL_TEST_PROMPT" --json >"$AGENT_OUT"
node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
const j = JSON.parse(raw);
const payloads = j?.result?.payloads;
const text = Array.isArray(payloads) && payloads[0] && typeof payloads[0].text === "string"
  ? payloads[0].text.trim() : "";
if (!text) {
  console.error("L3：agent --json 无 result.payloads[0].text:", raw.slice(0, 800));
  process.exit(1);
}
console.log("L3 助手回复（节选）:", text.slice(0, 200) + (text.length > 200 ? "..." : ""));
' "$AGENT_OUT"
rm -f "$AGENT_OUT"

echo ""
echo "qwen-cn-web 全流程（L1+L2+L3）已完成。"
