#!/usr/bin/env bash
# Xvfb :99 하단 전폭 1줄 VNC 단축키 HUD (Ctrl+Alt+1~5 포커스 · Ctrl+Alt+0 분할)
set -euo pipefail

DISPLAY_NUM="${HUMA_DISPLAY:-:99}"
export DISPLAY="${DISPLAY_NUM}"
PORT="${PORT:-3100}"
VNC_W="${HUMA_VNC_WIDTH:-2560}"
VNC_H="${HUMA_VNC_HEIGHT:-1080}"
HUD_H="${HUMA_VNC_HUD_HEIGHT:-48}"
HUD_Y=$((VNC_H - HUD_H))
DEPLOY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HUD_URL="http://127.0.0.1:${PORT}/vnc-hud"

wait_for_hud_url() {
  local tries="${HUMA_VNC_HUD_WAIT_SEC:-90}"
  for ((i = 1; i <= tries; i++)); do
    if curl -sf --max-time 2 "${HUD_URL}" >/dev/null 2>&1; then
      echo "[vnc-hud] server ready (${HUD_URL})"
      return 0
    fi
    sleep 1
  done
  echo "[vnc-hud] WARN: server not ready — launching HUD anyway" >&2
}

CHROME="${PLAYWRIGHT_EXECUTABLE_PATH:-chromium-browser}"
if ! command -v "${CHROME}" >/dev/null 2>&1; then
  CHROME="google-chrome"
fi
if ! command -v "${CHROME}" >/dev/null 2>&1; then
  CHROME="chromium"
fi

ARGS=(
  --app="${HUD_URL}"
  --window-position=0,"${HUD_Y}"
  --window-size="${VNC_W}","${HUD_H}"
  --no-first-run
  --no-default-browser-check
  --disable-infobars
  --disable-translate
  --disable-features=Translate,TranslateUI
  --disable-session-crashed-bubble
  --disable-restore-session-state
  --noerrdialogs
  --lang=ko-KR
)
if [[ "$(uname -s)" == "Linux" ]]; then
  # --test-type: --no-sandbox 경고 바가 40~48px 창 전체를 가리는 문제 방지
  ARGS+=(--test-type --no-sandbox --disable-dev-shm-usage)
fi

wait_for_hud_url

echo "[vnc-hud] ${HUD_URL} on ${DISPLAY} (${VNC_W}x${HUD_H} @ 0,${HUD_Y})"
exec "${CHROME}" "${ARGS[@]}"
