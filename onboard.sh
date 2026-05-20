#!/bin/bash
# OpenClaw onboard 向导启动脚本
# 支持官方 onboard 和 webauth (Web 模型授权)
# 兼容 macOS / Linux (含 Deepin) / Windows (Git Bash / WSL)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$SCRIPT_DIR/.openclaw-upstream-state"
CONFIG_FILE="$STATE_DIR/openclaw.json"

# ─── 环境检测 ────────────────────────────────────────────────
detect_os() {
  case "$OSTYPE" in
    darwin*)  echo "mac" ;;
    msys*|cygwin*|mingw*) echo "win" ;;
    *)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
  esac
}

detect_node() {
  if command -v node >/dev/null 2>&1; then
    echo "$(command -v node)"
    return
  fi
  # Windows 常见路径
  for p in \
    "$PROGRAMFILES/nodejs/node.exe" \
    "$LOCALAPPDATA/Programs/nodejs/node.exe"; do
    [ -f "$p" ] && echo "$p" && return
  done
  echo ""
}

OS=$(detect_os)
NODE=$(detect_node)

if [ -z "$NODE" ]; then
  echo "✗ 未找到 node，请先安装 Node.js: https://nodejs.org"
  exit 1
fi

echo "系统: $OS  |  Node: $($NODE --version 2>/dev/null)"

# ─── 初始化目录与配置 ─────────────────────────────────────────
mkdir -p "$STATE_DIR"

EXAMPLE_CONFIG="$SCRIPT_DIR/.openclaw-state.example/openclaw.json"
if [ ! -f "$CONFIG_FILE" ]; then
  if [ -f "$EXAMPLE_CONFIG" ]; then
    cp "$EXAMPLE_CONFIG" "$CONFIG_FILE"
    echo "已从示例复制配置文件: $EXAMPLE_CONFIG -> $CONFIG_FILE"
  else
    echo '{}' > "$CONFIG_FILE"
    echo "已创建空配置文件: $CONFIG_FILE（建议从 .openclaw-state.example/openclaw.json 复制完整配置）"
  fi
fi

export OPENCLAW_CONFIG_PATH="$CONFIG_FILE"
export OPENCLAW_STATE_DIR="$STATE_DIR"
export OPENCLAW_GATEWAY_PORT=3001

echo "配置文件: $OPENCLAW_CONFIG_PATH"
echo "状态目录: $OPENCLAW_STATE_DIR"
echo "端口: $OPENCLAW_GATEWAY_PORT"
echo ""

# ─── 帮助信息 ────────────────────────────────────────────────
show_help() {
  echo "用法: $0 [命令] [选项]"
  echo ""
  echo "命令:"
  echo "  onboard         启动官方 onboarding 向导（配置端口、token、API key 等）"
  echo "  webauth         启动 Web 模型授权向导（Claude、ChatGPT、DeepSeek 等）"
  echo "  configure       交互式配置向导"
  echo "  gateway         启动 Gateway 服务"
  echo ""
  echo "选项:"
  echo "  -h, --help      显示帮助信息"
  echo ""
  echo "示例:"
  echo "  $0                  # 显示帮助"
  echo "  $0 onboard          # 官方 onboarding"
  echo "  $0 webauth          # Web 模型授权"
  echo "  $0 configure       # 交互式配置"
}

# ─── 运行 ────────────────────────────────────────────────────
case "${1:-}" in
  -h|--help)
    show_help
    ;;
  webauth)
    echo "启动 Web 模型授权向导..."
    echo ""
    echo "⚠️  提示: 确保 Chrome 调试模式已启动 (./start-chrome-debug.sh)"
    echo ""
    "$NODE" "$SCRIPT_DIR/openclaw.mjs" onboard webauth
    ;;
  onboard)
    echo "启动官方 onboard 向导..."
    "$NODE" "$SCRIPT_DIR/openclaw.mjs" onboard "${@:2}"
    ;;
  configure)
    echo "启动配置向导..."
    "$NODE" "$SCRIPT_DIR/openclaw.mjs" configure "${@:2}"
    ;;
  gateway)
    echo "启动 Gateway..."
    "$NODE" "$SCRIPT_DIR/openclaw.mjs" gateway "${@:2}"
    ;;
  "")
    show_help
    ;;
  *)
    "$NODE" "$SCRIPT_DIR/openclaw.mjs" "$@"
    ;;
esac
