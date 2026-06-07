#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM="${HUMA_DISPLAY:-:99}"
RFB_PORT="${HUMA_VNC_PORT:-5900}"
LOG="/tmp/huma-x11vnc.log"

echo "[x11vnc] waiting for Xvfb ${DISPLAY_NUM}..."
for _ in $(seq 1 60); do
  if pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
  echo "[x11vnc] ERROR: Xvfb ${DISPLAY_NUM} not found" >&2
  exit 1
fi

# pm2/수동 이중 기동 시 좀비 소켓 방지
pkill -f "x11vnc.*-rfbport ${RFB_PORT}" 2>/dev/null || true
pkill -f "x11vnc.*-display ${DISPLAY_NUM}" 2>/dev/null || true
sleep 2

export DISPLAY="${DISPLAY_NUM}"

echo "[x11vnc] exec on ${DISPLAY_NUM} port ${RFB_PORT} (log: ${LOG})"
# 수동 기동과 동일 — exec 로 pm2 가 x11vnc 프로세스 직접 관리
exec x11vnc \
  -display "${DISPLAY_NUM}" \
  -forever \
  -shared \
  -nopw \
  -no6 \
  -listen 0.0.0.0 \
  -rfbport "${RFB_PORT}" \
  -noxdamage \
  -o "${LOG}"
