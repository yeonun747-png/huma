#!/usr/bin/env bash
# 수동 기동과 동일 — pkill/헬스체크 없음 (pm2 가 프로세스 관리)
export DISPLAY="${DISPLAY:-:99}"
exec x11vnc \
  -display "${DISPLAY}" \
  -forever \
  -shared \
  -nopw \
  -no6 \
  -listen 0.0.0.0 \
  -rfbport 5900 \
  -noxdamage
