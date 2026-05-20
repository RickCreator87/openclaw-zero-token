# shellcheck shell=bash
# 由 test-web-model-matrix.sh 和 test-web-model-e2e.sh source；
# 定义待测 provider/model（与 src/zero-token/bridge/web-providers.ts 目录一致）。

# 完整 Web 模型矩阵（13 个 provider）
WEB_MODEL_MATRIX_ENTRIES=(
  "claude-web/claude-sonnet-4-6"
  "chatgpt-web/gpt-4"
  "deepseek-web/deepseek-chat"
  "doubao-web/doubao-seed-2.0"
  "qwen-web/qwen3.5-plus"
  "qwen-cn-web/Qwen3.5-Plus"
  "kimi-web/moonshot-v1-32k"
  "gemini-web/gemini-pro"
  "grok-web/grok-2"
  "glm-web/glm-4-plus"
  "glm-intl-web/glm-4-plus"
  "perplexity-web/perplexity-web"
  "xiaomimo-web/xiaomimo-chat"
)
