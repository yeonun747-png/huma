#!/usr/bin/env bash
# Xvfb :99 — pm2 관리. sleep infinity 대신 Xvfb 종료 시 pm2 재시작 유도.
set -euo pipefail

DISPLAY_NUM="${HUMA_DISPLAY:-:99}"
SCREEN="${HUMA_XVFB_SCREEN:-1920x1080x24}"
XSOCK="/tmp/.X11-unix/X${DISPLAY_NUM#:}"

if pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1 && [[ -S "${XSOCK}" ]]; then
  echo "Xvfb ${DISPLAY_NUM} already running — watch until exit"
  while pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1 && [[ -S "${XSOCK}" ]]; do
    sleep 30
  done
  echo "Xvfb ${DISPLAY_NUM} gone — pm2 restart"
  exit 1
fi

exec Xvfb "${DISPLAY_NUM}" -screen 0 "${SCREEN}" -nolisten tcp -ac
