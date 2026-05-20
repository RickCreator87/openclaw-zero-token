#!/usr/bin/env bash
# ============================================================================
# Web 模型端到端自动化测试
# ============================================================================
# 完整测试流程：编译 → 启动浏览器调试 → 授权 → 启动网关 → 对每个已授权模型发消息 → 校验回复
#
# 所有端口、配置文件、状态目录均使用 zero-token 独立路径，不与系统 openclaw 混用。
#
# 用法：
#   bash scripts/test-web-model-e2e.sh                # 完整流程（含编译）
#   bash scripts/test-web-model-e2e.sh --skip-build   # 跳过编译
#   bash scripts/test-web-model-e2e.sh --skip-auth    # 跳过授权（已授权过）
#   bash scripts/test-web-model-e2e.sh --models "qwen-cn-web/Qwen3.5-Plus,deepseek-web/deepseek-chat"
#   bash scripts/test-web-model-e2e.sh --help
#
# 环境变量（可选覆盖）：
#   ZT_GATEWAY_PORT     网关端口（默认 3001）
#   ZT_CHROME_PORT      Chrome CDP 端口（默认 9222）
#   ZT_TIMEOUT          单个模型请求超时秒数（默认 120）
#   ZT_PROMPT           测试提示词
# ============================================================================
set -euo pipefail

# ─── 项目路径（zero-token 独立，不混用系统 openclaw） ─────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# zero-token 专属路径
ZT_STATE_DIR="$ROOT/.openclaw-upstream-state"
ZT_CONFIG_FILE="$ZT_STATE_DIR/openclaw.json"
ZT_AUTH_FILE="$ZT_STATE_DIR/agents/main/agent/auth-profiles.json"
ZT_PID_FILE="$ROOT/.gateway-test.pid"
ZT_GATEWAY_PORT="${ZT_GATEWAY_PORT:-3001}"
ZT_CHROME_PORT="${ZT_CHROME_PORT:-9222}"
ZT_TIMEOUT="${ZT_TIMEOUT:-120}"
ZT_PROMPT="${ZT_PROMPT:-用一句话回答：2+3等于几？只输出数字结果。}"
ZT_BASE_URL="http://127.0.0.1:${ZT_GATEWAY_PORT}"

# ─── 颜色输出 ─────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[PASS]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }
step()  { echo -e "\n${CYAN}══════════════════════════════════════════${NC}"; echo -e "${CYAN}  $*${NC}"; echo -e "${CYAN}══════════════════════════════════════════${NC}"; }

# ─── 参数解析 ─────────────────────────────────────────────────
SKIP_BUILD=false
SKIP_AUTH=false
SKIP_BROWSER=false
SELECTED_MODELS=""
CLEANUP_ON_EXIT=true

show_help() {
  cat <<'HELP'
Web 模型端到端测试

用法：bash scripts/test-web-model-e2e.sh [选项]

选项：
  --skip-build       跳过编译步骤（已编译过）
  --skip-auth        跳过授权步骤（已授权过）
  --skip-browser     跳过浏览器启动（已在运行）
  --models LIST      只测试指定模型，逗号分隔
                     例: --models "qwen-cn-web/Qwen3.5-Plus,kimi-web/moonshot-v1-32k"
  --no-cleanup       测试结束后不停止网关
  --help             显示此帮助

环境变量：
  ZT_GATEWAY_PORT    网关端口（默认 3001）
  ZT_CHROME_PORT     Chrome CDP 端口（默认 9222）
  ZT_TIMEOUT         单模型超时秒数（默认 120）
  ZT_PROMPT          测试提示词

路径说明（zero-token 独立，不混用系统 openclaw）：
  配置文件    .openclaw-upstream-state/openclaw.json
  授权凭证    .openclaw-upstream-state/agents/main/agent/auth-profiles.json
  网关端口    默认 3001（系统 openclaw 用 3000）
  浏览器数据  ~/Library/Application Support/Chrome-OpenClaw-Debug (mac)
              ~/.config/chrome-openclaw-debug (linux)
HELP
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --skip-build)   SKIP_BUILD=true ;;
    --skip-auth)    SKIP_AUTH=true ;;
    --skip-browser) SKIP_BROWSER=true ;;
    --no-cleanup)   CLEANUP_ON_EXIT=false ;;
    --help|-h)      show_help ;;
    --models)       :;; # 下一个 arg 是值
    --models=*)     SELECTED_MODELS="${arg#*=}" ;;
    *)
      # 检查是否是 --models 的值
      prev="${*:$((${#@}-1)):1}"
      if [[ "${prev:-}" == "--models" ]]; then
        SELECTED_MODELS="$arg"
      fi
      ;;
  esac
done

# 更健壮的 --models 解析
i=0
for arg in "$@"; do
  i=$((i + 1))
  if [[ "$arg" == "--models" ]]; then
    next_i=$((i + 1))
    j=0
    for a2 in "$@"; do
      j=$((j + 1))
      if [[ "$j" == "$next_i" ]]; then
        SELECTED_MODELS="$a2"
        break
      fi
    done
  fi
done

# ─── 前置检查 ─────────────────────────────────────────────────
step "阶段 0：前置检查"

check_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "未找到 $1，请先安装"
    return 1
  fi
  ok "$1 已安装"
}

check_tool node
check_tool curl
check_tool jq || warn "未安装 jq，回复校验将降级"

NODE="$(command -v node)"
info "Node 版本: $($NODE --version)"
info "项目根目录: $ROOT"
info "状态目录: $ZT_STATE_DIR"
info "配置文件: $ZT_CONFIG_FILE"
info "网关端口: $ZT_GATEWAY_PORT"
info "Chrome CDP 端口: $ZT_CHROME_PORT"

# 确保配置文件和状态目录存在
if [[ ! -f "$ZT_CONFIG_FILE" ]]; then
  warn "配置文件不存在，将从示例复制"
  mkdir -p "$ZT_STATE_DIR"
  EXAMPLE_CONFIG="$ROOT/.openclaw-state.example/openclaw.json"
  if [[ -f "$EXAMPLE_CONFIG" ]]; then
    cp "$EXAMPLE_CONFIG" "$ZT_CONFIG_FILE"
    ok "已复制配置: $EXAMPLE_CONFIG → $ZT_CONFIG_FILE"
  else
    fail "示例配置文件不存在: $EXAMPLE_CONFIG"
    exit 1
  fi
fi

# 读取 gateway token
GATEWAY_TOKEN=$(jq -r '.gateway.auth.token // empty' "$ZT_CONFIG_FILE" 2>/dev/null || true)
if [[ -z "$GATEWAY_TOKEN" ]]; then
  warn "配置文件中未找到 gateway.auth.token，某些测试可能失败"
  GATEWAY_TOKEN="test-token"
fi

# ─── 阶段 1：编译 ─────────────────────────────────────────────
if [[ "$SKIP_BUILD" == true ]]; then
  step "阶段 1：编译 [已跳过]"
else
  step "阶段 1：编译项目"

  info "运行 pnpm build ..."
  if pnpm build 2>&1 | tail -5; then
    ok "编译成功"
  else
    fail "编译失败"
    exit 1
  fi

  # 验证编译产物
  if [[ -f "$ROOT/openclaw.mjs" ]]; then
    ok "入口文件存在: openclaw.mjs"
  else
    fail "入口文件不存在: openclaw.mjs"
    exit 1
  fi

  if [[ -d "$ROOT/dist" ]]; then
    DIST_FILES=$(find "$ROOT/dist" -name "*.js" | wc -l | tr -d ' ')
    ok "dist 目录包含 ${DIST_FILES} 个 JS 文件"
  else
    fail "dist 目录不存在"
    exit 1
  fi
fi

# ─── 阶段 1.5：单元测试 ──────────────────────────────────────
step "阶段 1.5：Web Stream 单元测试"

if pnpm exec vitest run --config scripts/vitest.zero-token-web.config.ts 2>&1 | tail -10; then
  ok "单元测试通过"
else
  warn "单元测试失败（不阻塞后续测试）"
fi

# ─── 阶段 2：启动 Chrome 调试模式 ─────────────────────────────
if [[ "$SKIP_BROWSER" == true ]]; then
  step "阶段 2：启动 Chrome 调试模式 [已跳过]"
else
  step "阶段 2：启动 Chrome 调试模式"

  # 检查是否已有调试 Chrome 在运行
  if curl -s "http://127.0.0.1:${ZT_CHROME_PORT}/json/version" > /dev/null 2>&1; then
    ok "Chrome 调试模式已在运行 (端口 ${ZT_CHROME_PORT})"
    CHROME_VERSION=$(curl -s "http://127.0.0.1:${ZT_CHROME_PORT}/json/version" | jq -r '.Browser // "unknown"' 2>/dev/null || echo "unknown")
    info "Chrome 版本: $CHROME_VERSION"
  else
    info "启动 Chrome 调试模式..."
    if [[ -x "$ROOT/start-chrome-debug.sh" ]]; then
      # 在后台启动（脚本会等待 Chrome 就绪后退出）
      bash "$ROOT/start-chrome-debug.sh" &
      CHROME_LAUNCHER_PID=$!

      # 等待 Chrome CDP 可用
      info "等待 Chrome 就绪..."
      CHROME_READY=false
      for i in $(seq 1 30); do
        if curl -s "http://127.0.0.1:${ZT_CHROME_PORT}/json/version" > /dev/null 2>&1; then
          CHROME_READY=true
          break
        fi
        sleep 1
      done

      if [[ "$CHROME_READY" == true ]]; then
        ok "Chrome 调试模式已启动"
      else
        fail "Chrome 启动超时 (30s)"
        warn "请手动运行: ./start-chrome-debug.sh"
        warn "然后重新运行本测试并加上 --skip-browser"
        exit 1
      fi
    else
      fail "start-chrome-debug.sh 不存在或不可执行"
      exit 1
    fi
  fi
fi

# ─── 阶段 3：Web 模型授权 ─────────────────────────────────────
if [[ "$SKIP_AUTH" == true ]]; then
  step "阶段 3：Web 模型授权 [已跳过]"
else
  step "阶段 3：Web 模型授权检查"

  if [[ -f "$ZT_AUTH_FILE" ]]; then
    AUTH_PROFILES=$(jq -r '.profiles | keys[]' "$ZT_AUTH_FILE" 2>/dev/null || true)
    WEB_PROFILES=$(echo "$AUTH_PROFILES" | grep -E ".*-web:" || true)

    if [[ -n "$WEB_PROFILES" ]]; then
      info "已找到以下 Web 模型授权:"
      echo "$WEB_PROFILES" | while read -r profile; do
        ok "  $profile"
      done
    else
      warn "未找到任何 Web 模型授权"
      warn "请运行: ./onboard.sh webauth"
      warn "授权完成后重新运行本测试并加上 --skip-auth"
      exit 1
    fi
  else
    warn "auth-profiles.json 不存在"
    warn "请先运行: ./onboard.sh webauth"
    exit 1
  fi
fi

# ─── 阶段 4：启动网关 ─────────────────────────────────────────
step "阶段 4：启动网关"

# 检查网关是否已在运行
GATEWAY_RUNNING=false
if curl -s -o /dev/null --connect-timeout 2 "${ZT_BASE_URL}/healthz" 2>/dev/null; then
  GATEWAY_RUNNING=true
  ok "网关已在运行 (${ZT_BASE_URL})"
elif curl -s -o /dev/null --connect-timeout 2 "${ZT_BASE_URL}/health" 2>/dev/null; then
  GATEWAY_RUNNING=true
  ok "网关已在运行 (${ZT_BASE_URL})"
fi

if [[ "$GATEWAY_RUNNING" == false ]]; then
  info "启动网关..."

  # 确保旧进程已停止
  if [[ -f "$ZT_PID_FILE" ]]; then
    OLD_PID=$(cat "$ZT_PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
      info "停止旧网关进程 (PID: $OLD_PID)"
      kill "$OLD_PID" 2>/dev/null || true
      sleep 2
    fi
    rm -f "$ZT_PID_FILE"
  fi

  # zero-token 独立环境变量
  export OPENCLAW_CONFIG_PATH="$ZT_CONFIG_FILE"
  export OPENCLAW_STATE_DIR="$ZT_STATE_DIR"
  export OPENCLAW_GATEWAY_PORT="$ZT_GATEWAY_PORT"

  GW_LOG="/tmp/openclaw-e2e-gateway.log"
  nohup "$NODE" "$ROOT/openclaw.mjs" gateway --port "$ZT_GATEWAY_PORT" > "$GW_LOG" 2>&1 &
  GW_PID=$!
  echo "$GW_PID" > "$ZT_PID_FILE"
  info "网关 PID: $GW_PID, 日志: $GW_LOG"

  # 等待就绪
  GW_READY=false
  for i in $(seq 1 30); do
    if curl -s -o /dev/null --connect-timeout 1 "${ZT_BASE_URL}/" 2>/dev/null; then
      GW_READY=true
      break
    fi
    if ! kill -0 $GW_PID 2>/dev/null; then
      fail "网关进程退出，查看日志: $GW_LOG"
      tail -20 "$GW_LOG" 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done

  if [[ "$GW_READY" == true ]]; then
    ok "网关已就绪 (${i}s)"
  else
    fail "网关启动超时 (30s)，查看日志: $GW_LOG"
    tail -30 "$GW_LOG" 2>/dev/null || true
    exit 1
  fi
fi

# 健康检查
HEALTH_CODE=$(curl -sS -o /tmp/zt-e2e-health.json -w "%{http_code}" "${ZT_BASE_URL}/healthz" 2>/dev/null || echo "000")
if [[ "$HEALTH_CODE" != "200" ]]; then
  HEALTH_CODE=$(curl -sS -o /tmp/zt-e2e-health.json -w "%{http_code}" "${ZT_BASE_URL}/health" 2>/dev/null || echo "000")
fi

if [[ "$HEALTH_CODE" == "200" ]]; then
  ok "健康检查通过 (HTTP $HEALTH_CODE)"
else
  fail "健康检查失败 (HTTP $HEALTH_CODE)"
  cat /tmp/zt-e2e-health.json 2>/dev/null || true
  exit 1
fi


# ─── 阶段 5+：运行 E2E 测试 Runner ─────────────────────────────
step "阶段 5：运行 E2E 测试 (L2 + L3 + L5)"

# 传递环境变量给 TypeScript runner
export ZT_GATEWAY_PORT="$ZT_GATEWAY_PORT"
export ZT_CHROME_PORT="$ZT_CHROME_PORT"
export ZT_TIMEOUT="$ZT_TIMEOUT"
export ZT_GATEWAY_TOKEN="$GATEWAY_TOKEN"
export ZT_REPORT_DIR="$ROOT/reports"

if [[ -n "$SELECTED_MODELS" ]]; then
  export ZT_MODELS="$SELECTED_MODELS"
fi

# 支持跳过特定层级
for arg in "$@"; do
  case "$arg" in
    --skip-l2) export ZT_SKIP_L2=1 ;;
    --skip-l3) export ZT_SKIP_L3=1 ;;
    --skip-l5) export ZT_SKIP_L5=1 ;;
  esac
done

info "调用 TypeScript E2E Runner..."
info "  L2 HTTP:       ${ZT_SKIP_L2:+跳过}${ZT_SKIP_L2:-启用}"
info "  L3 WebSocket:  ${ZT_SKIP_L3:+跳过}${ZT_SKIP_L3:-启用}"
info "  L5 Browser UI: ${ZT_SKIP_L5:+跳过}${ZT_SKIP_L5:-启用}"
echo ""

RUNNER_EXIT=0
"$NODE" --import tsx "$ROOT/scripts/test-web-e2e-runner.ts" || RUNNER_EXIT=$?

# ─── 清理 ─────────────────────────────────────────────────────
if [[ "$CLEANUP_ON_EXIT" == true && -f "$ZT_PID_FILE" ]]; then
  GW_PID=$(cat "$ZT_PID_FILE" 2>/dev/null || true)
  if [[ -n "$GW_PID" ]] && kill -0 "$GW_PID" 2>/dev/null; then
    info "停止测试网关 (PID: $GW_PID)"
    kill "$GW_PID" 2>/dev/null || true
    rm -f "$ZT_PID_FILE"
  fi
fi

# 输出路径确认
echo ""
info "路径确认（zero-token 独立，未混用系统 openclaw）:"
info "  配置文件:   $ZT_CONFIG_FILE"
info "  授权凭证:   $ZT_AUTH_FILE"
info "  网关端口:   $ZT_GATEWAY_PORT"
info "  Chrome 端口: $ZT_CHROME_PORT"
info "  状态目录:   $ZT_STATE_DIR"
info "  报告目录:   $ZT_REPORT_DIR"

exit $RUNNER_EXIT
