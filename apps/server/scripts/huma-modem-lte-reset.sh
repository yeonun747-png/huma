#!/bin/bash
# ZTE RNDIS LTE — 공인 IP 변경 (AT+CFUN 비행기모드 또는 장시간 link disconnect)
# Usage: sudo bash huma-modem-lte-reset.sh eth5

set -euo pipefail

IFACE="${1:?iface required}"
LINK_DOWN_SEC="${HUMA_MODEM_LINK_DOWN_SEC:-35}"

find_at_port() {
  local iface="$1" net_dev tty_path tty_dev tty_name
  net_dev=$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null) || return 1
  for tty_path in /sys/class/tty/ttyUSB*/device /sys/class/tty/ttyACM*/device; do
    [ -e "$tty_path" ] || continue
    tty_dev=$(readlink -f "$tty_path")
    if [[ "$tty_dev" == "$net_dev"* ]] || [[ "$net_dev" == "$tty_dev"* ]]; then
      tty_name="/dev/$(basename "$(dirname "$tty_path")")"
      echo "$tty_name"
      return 0
    fi
  done
  return 1
}

send_at() {
  local dev="$1" cmd="$2" out
  stty -F "$dev" 115200 raw -echo 2>/dev/null || true
  out=$(timeout 4 sh -c "printf '%s' \"$cmd\" > \"$dev\" && sleep 0.4 && head -c 256 < \"$dev\"" 2>/dev/null || true)
  printf '%s' "$out"
}

at_airplane_toggle() {
  local dev="$1" resp
  resp=$(send_at "$dev" $'AT\r')
  if ! printf '%s' "$resp" | grep -qi OK; then
    return 1
  fi
  send_at "$dev" $'AT+CFUN=0\r' >/dev/null || true
  sleep 12
  send_at "$dev" $'AT+CFUN=1\r' >/dev/null || true
  sleep 28
  ip link set "$IFACE" up 2>/dev/null || true
  dhclient -1 -v "$IFACE" 2>/dev/null || true
  sleep 10
  return 0
}

AT_PORT=""
AT_PORT=$(find_at_port "$IFACE" || true)
if [ -n "$AT_PORT" ] && [ -e "$AT_PORT" ]; then
  if at_airplane_toggle "$AT_PORT"; then
    echo "✓ ${IFACE} AT+CFUN airplane (${AT_PORT})"
    exit 0
  fi
  echo "⚠ ${IFACE} AT 실패 — link disconnect fallback"
fi

ip link set "$IFACE" down 2>/dev/null || true
sleep "$LINK_DOWN_SEC"
ip link set "$IFACE" up 2>/dev/null || true
sleep 15
dhclient -1 -v "$IFACE" 2>/dev/null || true
sleep 10
echo "✓ ${IFACE} link disconnect ${LINK_DOWN_SEC}s"
