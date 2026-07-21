#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${ROOT}/../api/public/agent"
mkdir -p "$OUT"

build() {
  local os="$1" arch="$2"
  local name="status-agent-${os}-${arch}"
  echo "Building $name"
  (cd "$ROOT" && CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -ldflags="-s -w" -o "$OUT/$name" .)
}

build linux amd64
build linux arm64
build darwin amd64
build darwin arm64

cp "$ROOT/install.sh" "$OUT/install.sh"
cp "$ROOT/status-agent.service" "$OUT/status-agent.service"
chmod +x "$OUT/install.sh" "$OUT"/status-agent-*

echo "Artifacts in $OUT"
ls -lh "$OUT"
