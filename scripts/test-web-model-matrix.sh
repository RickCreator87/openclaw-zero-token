#!/usr/bin/env bash
# Web 模型 HTTP 冒烟矩阵：对若干 provider 各发一条 /v1/chat/completions（等同 Web UI 选模型后走 OpenAI 兼容入口）。
# 已排除（你已验证）：claude-web、gemini-web、deepseek-web、doubao-web、glm-web、glm-intl-web、xiaomimo-web
# 依赖：网关已启动 + 各 provider 已完成 onboard；环境变量见下文。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/web-model-http-matrix.inc.sh
source "$ROOT/scripts/web-model-http-matrix.inc.sh"

UNIT_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --unit-only) UNIT_ONLY=true ;;
    *)
      echo "未知参数: $arg（支持 --unit-only：只跑离线 Vitest）" >&2
      exit 2
      ;;
  esac
done

echo "==> [矩阵-阶段 1] Zero Token web stream 单元测试"
pnpm exec vitest run --config scripts/vitest.zero-token-web.config.ts

if [[ "$UNIT_ONLY" == true ]]; then
  echo "已使用 --unit-only，跳过 HTTP 矩阵。"
  exit 0
fi

if [[ -z "${WEB_MODEL_TEST_URL:-}" || -z "${WEB_MODEL_TEST_TOKEN:-}" ]]; then
  echo ""
  echo "未设置 WEB_MODEL_TEST_URL / WEB_MODEL_TEST_TOKEN，跳过 HTTP 活测矩阵。"
  echo "要跑完整矩阵，请设置后重试，例如："
  echo "  export WEB_MODEL_TEST_URL=http://127.0.0.1:3001"
  echo "  export WEB_MODEL_TEST_TOKEN=<gateway.auth.token>"
  echo "  bash scripts/test-web-model-matrix.sh"
  exit 0
fi

BASE="${WEB_MODEL_TEST_URL%/}"
PROMPT="${WEB_MODEL_TEST_PROMPT:-用一句话回答：2+3=? 只输出数字。}"

echo ""
echo "==> [矩阵-健康检查] ${BASE}/healthz"
code="$(curl -sS -o /tmp/openclaw-mx-health.json -w "%{http_code}" "${BASE}/healthz" || true)"
if [[ "$code" != "200" ]]; then
  code="$(curl -sS -o /tmp/openclaw-mx-health.json -w "%{http_code}" "${BASE}/health" || true)"
fi
if [[ "$code" != "200" ]]; then
  echo "网关不可达 (http=$code)，跳过矩阵。" >&2
  cat /tmp/openclaw-mx-health.json 2>/dev/null || true
  exit 1
fi
echo "health OK"

failed=0
for model in "${WEB_MODEL_MATRIX_ENTRIES[@]}"; do
  echo ""
  echo "==> [矩阵] model=${model}"
  BODY="$(MODEL_JSON="$model" PROMPT_JSON="$PROMPT" node -e '
const model = process.env.MODEL_JSON;
const prompt = process.env.PROMPT_JSON;
console.log(JSON.stringify({
  model,
  messages: [{ role: "user", content: prompt }],
  stream: false,
}));
')"
  resp_code="$(curl -sS -o /tmp/openclaw-mx-chat.json -w "%{http_code}" \
    -X POST "${BASE}/v1/chat/completions" \
    -H "Authorization: Bearer ${WEB_MODEL_TEST_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$BODY")"
  if [[ "$resp_code" != "200" ]]; then
    echo "  FAIL HTTP $resp_code" >&2
    head -c 1200 /tmp/openclaw-mx-chat.json >&2 || true
    echo >&2
    failed=$((failed + 1))
    continue
  fi
  if command -v jq >/dev/null 2>&1; then
    content="$(jq -r '.choices[0].message.content // empty' /tmp/openclaw-mx-chat.json)"
    if [[ -z "${content// }" ]]; then
      echo "  FAIL 200 但 content 为空" >&2
      failed=$((failed + 1))
      continue
    fi
    echo "  OK 回复节选: ${content:0:120}$([[ ${#content} -gt 120 ]] && echo ...)"
  else
    echo "  OK (未装 jq，未校验 content)"
  fi
done

echo ""
if [[ "$failed" -gt 0 ]]; then
  echo "矩阵完成：${#WEB_MODEL_MATRIX_ENTRIES[@]} 项中 ${failed} 项失败。" >&2
  exit 1
fi
echo "矩阵完成：${#WEB_MODEL_MATRIX_ENTRIES[@]} 项全部通过。"
