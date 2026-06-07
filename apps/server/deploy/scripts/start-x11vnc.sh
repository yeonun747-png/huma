#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM="${HUMA_DISPLAY:-:99}"
RFB_PORT="${HUMA_VNC_PORT:-5900}"
LOG="/tmp/huma-x11vnc.log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

stop_x11vnc() {
  pkill -f "x11vnc.*-rfbport ${RFB_PORT}" 2>/dev/null || true
  pkill -f "x11vnc.*-display ${DISPLAY_NUM}" 2>/dev/null || true
  sleep 1
}

wait_xvfb() {
  log "waiting for Xvfb ${DISPLAY_NUM}..."
  for _ in $(seq 1 60); do
    if pgrep -f "Xvfb ${DISPLAY_NUM} " >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  log "ERROR: Xvfb ${DISPLAY_NUM} not found"
  return 1
}

# TCP만 열리고 RFB 배너가 없으면 RealVNC가 Connecting... 에서 멈춤
check_rfb_banner() {
  timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/${RFB_PORT}; head -c 12 <&3" 2>/dev/null | grep -q '^RFB ' || return 1
}

start_once() {
  stop_x11vnc
  export DISPLAY="${DISPLAY_NUM}"

  log "starting x11vnc on ${DISPLAY_NUM} port ${RFB_PORT}"
  x11vnc \
    -display "${DISPLAY_NUM}" \
    -forever \
    -shared \
    -nopw \
    -no6 \
    -listen 0.0.0.0 \
    -rfbport "${RFB_PORT}" \
    -noxdamage \
    -o "${LOG}" \
    -verbose &
  local pid=$!

  for _ in $(seq 1 10); do
    sleep 1
    if check_rfb_banner; then
      log "RFB banner OK (pid ${pid})"
      wait "${pid}"
      return $?
    fi
  done

  log "ERROR: no RFB banner on :${RFB_PORT} — killing pid ${pid}"
  kill "${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
  return 1
}

wait_xvfb

while true; do
  start_once || log "x11vnc failed, retry in 3s"
  sleep 3
done
