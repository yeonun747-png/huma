#!/bin/bash
# ZTE RNDIS LTE — 공인 IP 변경 (AT+CFUN 비행기모드 또는 장시간 link disconnect)
# Usage: sudo bash huma-modem-lte-reset.sh eth5 [proxyPort]
#
# proxyPort(선택): policy routing 즉시 복구 (예: 10007)

set -euo pipefail

IFACE="${1:?iface required}"
PROXY_PORT="${2:-}"
LINK_DOWN_SEC="${HUMA_MODEM_LINK_DOWN_SEC:-45}"
AT_CONF="${HUMA_DONGLE_AT_PORTS_CONF:-/etc/huma/dongle-at-ports.conf}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usb_port_id() {
  local sysfs="$1"
  readlink -f "$sysfs" 2>/dev/null | grep -oE '[0-9]+-[0-9]+(\.[0-9]+)?' | head -1
}

read_conf_at_port() {
  local iface="$1"
  [ -f "$AT_CONF" ] || return 1
  local line port
  line=$(grep -E "^${iface}=" "$AT_CONF" 2>/dev/null | head -1) || return 1
  port="${line#*=}"
  port="${port//[[:space:]]/}"
  [ -n "$port" ] && [ -e "$port" ] && echo "$port"
}

# 동일 USB 물리 포트(3-1 등)의 ttyUSB 전부 — ZTE는 net(tty)와 AT(ttyUSB) 경로가 다름
find_at_ports_for_iface() {
  local iface="$1"
  local net_sysfs="/sys/class/net/${iface}/device"
  local net_port tty_path tty_name tty_port

  conf_port=$(read_conf_at_port "$iface" || true)
  if [ -n "${conf_port:-}" ]; then
    echo "$conf_port"
    return 0
  fi

  [ -e "$net_sysfs" ] || return 1
  net_port=$(usb_port_id "$net_sysfs")
  [ -n "$net_port" ] || return 1

  for tty_path in /sys/class/tty/ttyUSB*/device /sys/class/tty/ttyACM*/device; do
    [ -e "$tty_path" ] || continue
    tty_port=$(usb_port_id "$tty_path")
    [ "$tty_port" = "$net_port" ] || continue
    tty_name="/dev/$(basename "$(dirname "$tty_path")")"
    echo "$tty_name"
  done
}

send_at() {
  local dev="$1" cmd="$2" out
  stty -F "$dev" 115200 raw -echo 2>/dev/null || true
  # ZTE: CR 필수
  out=$(timeout 5 sh -c "printf '%s\r' \"$cmd\" > \"$dev\" && sleep 0.5 && head -c 512 < \"$dev\"" 2>/dev/null || true)
  printf '%s' "$out"
}

at_port_ready() {
  local dev="$1" resp
  resp=$(send_at "$dev" 'AT')
  printf '%s' "$resp" | grep -qi OK
}

at_airplane_toggle() {
  local dev="$1" resp
  if ! at_port_ready "$dev"; then
    return 1
  fi
  send_at "$dev" 'AT+CFUN=0' >/dev/null || true
  sleep 8
  send_at "$dev" 'AT+CFUN=1' >/dev/null || true
  sleep 20
  # 일부 ZTE: 소프트 리셋
  resp=$(send_at "$dev" 'AT+CFUN=1,1')
  if ! printf '%s' "$resp" | grep -qi OK; then
    send_at "$dev" 'AT+CFUN=1' >/dev/null || true
  fi
  sleep 15
  ip link set "$IFACE" up 2>/dev/null || true
  dhclient -r "$IFACE" 2>/dev/null || true
  dhclient -1 "$IFACE" 2>/dev/null || true
  sleep 8
  return 0
}

link_disconnect_fallback() {
  dhclient -r "$IFACE" 2>/dev/null || true
  ip link set "$IFACE" down 2>/dev/null || true
  sleep "$LINK_DOWN_SEC"
  ip link set "$IFACE" up 2>/dev/null || true
  sleep 12
  dhclient -1 "$IFACE" 2>/dev/null || true
  sleep 10
}

apply_policy_route() {
  [ -n "$PROXY_PORT" ] || return 0
  bash "$SCRIPT_DIR/huma-dongle-routes.sh" "${IFACE}:${PROXY_PORT}" >/dev/null 2>&1 || true
}

AT_OK=0
while IFS= read -r at_port; do
  [ -n "$at_port" ] || continue
  if at_airplane_toggle "$at_port"; then
    apply_policy_route
    echo "✓ ${IFACE} AT+CFUN airplane (${at_port})"
    AT_OK=1
    break
  fi
done < <(find_at_ports_for_iface "$IFACE" || true)

if [ "$AT_OK" -eq 1 ]; then
  exit 0
fi

link_disconnect_fallback
apply_policy_route
echo "✓ ${IFACE} link disconnect ${LINK_DOWN_SEC}s (AT 포트 미발견 또는 CFUN 실패)"
