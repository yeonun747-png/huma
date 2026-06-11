#!/usr/bin/env bash
# Xvfb :99 좌상단 VNC 단축키 HUD (F1~F5 포커스 · F10 분할)
set -euo pipefail

DISPLAY_NUM="${HUMA_DISPLAY:-:99}"
export DISPLAY="${DISPLAY_NUM}"
PORT="${PORT:-3100}"
DEPLOY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HUD_URL="http://127.0.0.1:${PORT}/vnc-hud"

CHROME="${PLAYWRIGHT_EXECUTABLE_PATH:-chromium-browser}"
if ! command -v "${CHROME}" >/dev/null 2>&1; then
  CHROME="google-chrome"
fi
if ! command -v "${CHROME}" >/dev/null 2>&1; then
  CHROME="chromium"
fi

ARGS=(
  --app="${HUD_URL}"
  --window-position=8,8
  --window-size=248,200
  --no-first-run
  --no-default-browser-check
  --disable-infobars
  --lang=ko-KR
)
if [[ "$(uname -s)" == "Linux" ]]; then
  ARGS+=(--no-sandbox --disable-dev-shm-usage)
fi

echo "[vnc-hud] ${HUD_URL} on ${DISPLAY}"
exec "${CHROME}" "${ARGS[@]}"
