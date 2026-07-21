#!/usr/bin/env bash
# Remote install for status-agent
# Usage:
#   curl -fsSL "$API_URL/v1/agent/install.sh" | sudo bash -s -- --api-url "$API_URL" --token "$NODE_TOKEN"
set -euo pipefail

API_URL=""
TOKEN=""
INTERVAL_MS="15000"
INSTALL_DIR="/usr/local/bin"
ENV_DIR="/etc/status-agent"
SERVICE_NAME="status-agent"
GITHUB_RAW="https://raw.githubusercontent.com/akaderkin/status/main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url) API_URL="${2%/}"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --interval-ms) INTERVAL_MS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$API_URL" || -z "$TOKEN" ]]; then
  echo "Usage: $0 --api-url https://api.example.com --token sn_xxx"
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)"
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

case "$OS" in
  linux) ;;
  darwin) echo "macOS install supported for binary only; systemd skipped" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

BINARY_NAME="status-agent-${OS}-${ARCH}"
API_BINARY_URL="$API_URL/v1/agent/download/${OS}/${ARCH}"
GH_BINARY_URL="$GITHUB_RAW/apps/api/public/agent/${BINARY_NAME}"
TMP="$(mktemp)"

echo "Downloading agent binary..."
if ! curl -fsSL "$API_BINARY_URL" -o "$TMP"; then
  echo "API binary 404/fail — falling back to GitHub"
  curl -fsSL "$GH_BINARY_URL" -o "$TMP"
fi
chmod +x "$TMP"
install -m 0755 "$TMP" "$INSTALL_DIR/status-agent"
rm -f "$TMP"

id status-agent >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin status-agent

mkdir -p "$ENV_DIR"
cat > "$ENV_DIR/agent.env" <<EOF
STATUS_API_URL=$API_URL
NODE_TOKEN=$TOKEN
AGENT_INTERVAL_MS=$INTERVAL_MS
EOF
chmod 600 "$ENV_DIR/agent.env"
chown -R status-agent:status-agent "$ENV_DIR" 2>/dev/null || true

if [[ "$OS" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
  if ! curl -fsSL "$API_URL/v1/agent/systemd.service" -o /etc/systemd/system/${SERVICE_NAME}.service; then
    curl -fsSL "$GITHUB_RAW/apps/agent/status-agent.service" -o /etc/systemd/system/${SERVICE_NAME}.service
  fi
  systemctl daemon-reload
  systemctl enable --now ${SERVICE_NAME}
  systemctl --no-pager --full status ${SERVICE_NAME} || true
  echo "Installed and started ${SERVICE_NAME}"
else
  echo "Binary installed to $INSTALL_DIR/status-agent"
  echo "Run: STATUS_API_URL=$API_URL NODE_TOKEN=*** $INSTALL_DIR/status-agent"
fi

echo "Done."
