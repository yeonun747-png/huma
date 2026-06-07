#!/usr/bin/env bash
# x11vnc — Xvfb :99 준비 후 기동 (systemd ExecStart)
set -euo pipefail

DISPLAY_NUM="${DISPLAY:-:99}"
RFB_PORT="${HUMA_VNC_PORT:-5900}"
LOG="/tmp/huma-x11vnc.log"
X11VNC="$(command -v x11vnc)"

log() { echo "[$(date -Iseconds)] $*" >>"$LOG"; }

log "waiting for Xvfb ${DISPLAY_NUM}..."
for _ in $(seq 1 120); do
  if pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
    log "Xvfb ${DISPLAY_NUM} ready"
    break
  fi
  sleep 1
done

if ! pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
  log "FATAL: Xvfb ${DISPLAY_NUM} not found after 120s"
  exit 1
fi

export DISPLAY="${DISPLAY_NUM}"
log "exec ${X11VNC} on port ${RFB_PORT}"

# pm2 stdout 파이프 사용 안 함 — systemd가 로그 파일로 직접 수집
exec "$X11VNC" \
  -display "${DISPLAY_NUM}" \
  -forever \
  -shared \
  -nopw \
  -no6 \
  -listen 0.0.0.0 \
  -rfbport "${RFB_PORT}" \
  -noxdamage \
  -quiet
