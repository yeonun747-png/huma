#!/usr/bin/env bash
# pm2 stdout 파이프가 차면 x11vnc accept 가 멈춤 → 파일로 리다이렉트
export DISPLAY="${DISPLAY:-:99}"
LOG="/tmp/huma-x11vnc.log"
exec >>"$LOG" 2>&1
echo "[$(date -Iseconds)] x11vnc start DISPLAY=${DISPLAY}"
exec x11vnc \
  -display "${DISPLAY}" \
  -forever \
  -shared \
  -nopw \
  -no6 \
  -listen 0.0.0.0 \
  -rfbport 5900 \
  -noxdamage \
  -quiet
