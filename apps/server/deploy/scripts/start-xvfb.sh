#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM="${HUMA_DISPLAY:-:99}"
SCREEN="${HUMA_XVFB_SCREEN:-1920x1080x24}"

if pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
  echo "Xvfb ${DISPLAY_NUM} already running — PM2 keepalive"
  exec sleep infinity
fi

exec Xvfb "${DISPLAY_NUM}" -screen 0 "${SCREEN}" -nolisten tcp -ac
