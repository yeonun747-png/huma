#!/usr/bin/env bash
# x11vnc — systemd ExecStart (bash 로 직접 호출)
set -euo pipefail

DISPLAY_NUM="${DISPLAY:-:99}"
RFB_PORT="${HUMA_VNC_PORT:-5900}"
LOG="/tmp/huma-x11vnc.log"
XSOCK="/tmp/.X11-unix/X${DISPLAY_NUM#:}"
X11VNC="/usr/bin/x11vnc"
[[ -x "${X11VNC}" ]] || X11VNC="$(command -v x11vnc || true)"
[[ -n "${X11VNC}" && -x "${X11VNC}" ]] || { echo "x11vnc not found" >&2; exit 1; }

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG" >&2; }

log "waiting for X11 socket ${XSOCK}..."
for _ in $(seq 1 120); do
  if [[ -S "${XSOCK}" ]] && pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
    if DISPLAY="${DISPLAY_NUM}" xdpyinfo >/dev/null 2>&1; then
      log "DISPLAY ${DISPLAY_NUM} ready"
      break
    fi
  fi
  sleep 1
done

if ! [[ -S "${XSOCK}" ]] || ! DISPLAY="${DISPLAY_NUM}" xdpyinfo >/dev/null 2>&1; then
  log "FATAL: DISPLAY ${DISPLAY_NUM} not ready — pm2 restart huma-xvfb 후 재시도"
  exit 1
fi

export DISPLAY="${DISPLAY_NUM}"
log "starting ${X11VNC} on port ${RFB_PORT}"

exec "${X11VNC}" \
  -display "${DISPLAY_NUM}" \
  -forever \
  -shared \
  -nopw \
  -no6 \
  -listen 0.0.0.0 \
  -rfbport "${RFB_PORT}" \
  -noxdamage \
  -quiet
