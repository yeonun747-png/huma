#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM="${HUMA_DISPLAY:-:99}"
RFB_PORT="${HUMA_VNC_PORT:-5900}"

echo "[x11vnc] waiting for Xvfb ${DISPLAY_NUM}..."
for _ in $(seq 1 60); do
  if pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
  echo "[x11vnc] Xvfb ${DISPLAY_NUM} not found" >&2
  exit 1
fi

pkill -f "x11vnc.*-display ${DISPLAY_NUM}" 2>/dev/null || true
sleep 1

echo "[x11vnc] starting on ${DISPLAY_NUM} port ${RFB_PORT}"
exec x11vnc \
  -display "${DISPLAY_NUM}" \
  -forever \
  -shared \
  -nopw \
  -listen 0.0.0.0 \
  -rfbport "${RFB_PORT}" \
  -noxdamage
