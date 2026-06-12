#!/usr/bin/env bash
# Xvfb :99 좌상단 오버레이 HUD — 브라우저 창은 HUD 아래(y≥reserve)만 사용
set -euo pipefail

DISPLAY_NUM="${HUMA_DISPLAY:-:99}"
export DISPLAY="${DISPLAY_NUM}"
PORT="${PORT:-3100}"
VNC_W="${HUMA_VNC_WIDTH:-2560}"
VNC_H="${HUMA_VNC_HEIGHT:-1080}"
HUD_W="${HUMA_VNC_HUD_WIDTH:-1180}"
HUD_H="${HUMA_VNC_HUD_HEIGHT:-56}"
HUD_RESERVE="${HUMA_VNC_HUD_RESERVE_Y:-$((HUD_H + 16))}"
DEPLOY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HUD_URL="http://127.0.0.1:${PORT}/vnc-hud"
HUD_TITLE="HUMA VNC HUD"

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

raise_hud_window() {
  if command -v wmctrl >/dev/null 2>&1; then
    local wid
    wid="$(wmctrl -l 2>/dev/null | grep -F "${HUD_TITLE}" | awk '{print $1}' | head -1)"
    if [[ -n "${wid}" ]]; then
      wmctrl -i -r "${wid}" -e "0,8,8,${HUD_W},${HUD_H}" 2>/dev/null || true
      wmctrl -i -r "${wid}" -b add,above,sticky 2>/dev/null || true
      wmctrl -i -a "${wid}" 2>/dev/null || true
    fi
  fi
  if command -v xdotool >/dev/null 2>&1; then
    xdotool search --name "${HUD_TITLE}" windowraise 2>/dev/null || true
  fi
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
  --window-position=8,8
  --window-size="${HUD_W}","${HUD_H}"
  --always-on-top
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
  ARGS+=(--test-type --no-sandbox --disable-dev-shm-usage)
fi

wait_for_hud_url

echo "[vnc-hud] overlay ${HUD_URL} on ${DISPLAY} (${HUD_W}x${HUD_H} @ 8,8 · workflow y>=${HUD_RESERVE})"
"${CHROME}" "${ARGS[@]}" &
CHROME_PID=$!

for _ in $(seq 1 30); do
  raise_hud_window
  sleep 0.5
done

while kill -0 "${CHROME_PID}" 2>/dev/null; do
  raise_hud_window
  sleep 2
done

wait "${CHROME_PID}"
