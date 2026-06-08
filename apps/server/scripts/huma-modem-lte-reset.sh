#!/bin/bash
# ZTE RNDIS LTE — 공인 IP 변경 (단계별 AT+CFUN / link disconnect)
# Usage: sudo bash huma-modem-lte-reset.sh eth5 [proxyPort] [tier]
#
# tier: 1=AT 소프트(빠름)  2=AT 하드+link45  3=link60+AT 하드 (최후)
# env: HUMA_DONGLE_AT_PORT=/dev/ttyUSB17 (Redis 캐시·conf 우선)

set -euo pipefail

IFACE="${1:?iface required}"
PROXY_PORT="${2:-}"
TIER="${3:-1}"
LINK_DOWN_SEC="${HUMA_MODEM_LINK_DOWN_SEC:-45}"
AT_CONF="${HUMA_DONGLE_AT_PORTS_CONF:-/etc/huma/dongle-at-ports.conf}"
CACHED_AT="${HUMA_DONGLE_AT_PORT:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 3-1.4.2:1.0 → 3-1.4.2 (동글 물리 단위 — 3-1 허브와 구분)
usb_iface_leaf() {
  local p
  p=$(readlink -f "$1" 2>/dev/null) || return 1
  basename "${p%%:*}"
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

find_at_ports_for_iface() {
  local iface="$1"
  local net_sysfs="/sys/class/net/${iface}/device"
  local net_port tty_path tty_name tty_port

  if [ -n "$CACHED_AT" ] && [ -e "$CACHED_AT" ]; then
    echo "$CACHED_AT"
  fi

  conf_port=$(read_conf_at_port "$iface" || true)
  if [ -n "${conf_port:-}" ]; then
    echo "$conf_port"
  fi

  [ -e "$net_sysfs" ] || return 0
  net_leaf=$(usb_iface_leaf "$net_sysfs") || return 0

  for tty_path in /sys/class/tty/ttyACM*/device /sys/class/tty/ttyUSB*/device; do
    [ -e "$tty_path" ] || continue
    tty_leaf=$(usb_iface_leaf "$tty_path" || true)
    [ -n "$tty_leaf" ] && [ "$tty_leaf" = "$net_leaf" ] || continue
    tty_name="/dev/$(basename "$(dirname "$tty_path")")"
    echo "$tty_name"
  done
}

send_at() {
  local dev="$1" cmd="$2" out
  stty -F "$dev" 115200 raw -echo min 0 time 10 2>/dev/null || true
  timeout 0.3 cat "$dev" >/dev/null 2>&1 || true
  out=$(timeout 6 sh -c "printf '%s\r' \"$cmd\" > \"$dev\"; sleep 1; head -c 512 < \"$dev\"" 2>/dev/null || true)
  printf '%s' "$out"
}

at_port_ready() {
  local dev="$1" resp
  resp=$(send_at "$dev" 'AT')
  printf '%s' "$resp" | grep -qi OK
}

at_soft_toggle() {
  local dev="$1"
  if ! at_port_ready "$dev"; then return 1; fi
  send_at "$dev" 'AT+CFUN=0' >/dev/null || true
  sleep 5
  send_at "$dev" 'AT+CFUN=1' >/dev/null || true
  sleep 15
  renew_dhcp
  return 0
}

at_hard_toggle() {
  local dev="$1" resp
  if ! at_port_ready "$dev"; then return 1; fi
  send_at "$dev" 'AT+CFUN=0' >/dev/null || true
  sleep 8
  send_at "$dev" 'AT+CFUN=1' >/dev/null || true
  sleep 18
  resp=$(send_at "$dev" 'AT+CFUN=1,1')
  if ! printf '%s' "$resp" | grep -qi OK; then
    send_at "$dev" 'AT+CFUN=1' >/dev/null || true
  fi
  sleep 12
  renew_dhcp
  return 0
}

renew_dhcp() {
  ip link set "$IFACE" up 2>/dev/null || true
  dhclient -r "$IFACE" 2>/dev/null || true
  dhclient -1 "$IFACE" 2>/dev/null || true
  sleep 6
}

link_disconnect() {
  local sec="$1"
  dhclient -r "$IFACE" 2>/dev/null || true
  ip link set "$IFACE" down 2>/dev/null || true
  sleep "$sec"
  ip link set "$IFACE" up 2>/dev/null || true
  sleep 10
  dhclient -1 "$IFACE" 2>/dev/null || true
  sleep 8
}

apply_policy_route() {
  [ -n "$PROXY_PORT" ] || return 0
  bash "$SCRIPT_DIR/huma-dongle-routes.sh" "${IFACE}:${PROXY_PORT}" >/dev/null 2>&1 || true
}

try_at_mode() {
  local mode="$1"
  local at_port
  while IFS= read -r at_port; do
    [ -n "$at_port" ] || continue
    if [ "$mode" = "soft" ]; then
      if at_soft_toggle "$at_port"; then
        apply_policy_route
        echo "✓ ${IFACE} AT+CFUN airplane (${at_port})"
        return 0
      fi
    else
      if at_hard_toggle "$at_port"; then
        apply_policy_route
        echo "✓ ${IFACE} AT+CFUN airplane (${at_port})"
        return 0
      fi
    fi
  done < <(find_at_ports_for_iface "$IFACE" | awk '!seen[$0]++')
  return 1
}

case "$TIER" in
  1)
    if try_at_mode soft; then exit 0; fi
    link_disconnect 25
    apply_policy_route
    echo "✓ ${IFACE} link disconnect 25s tier1"
    ;;
  2)
    if try_at_mode hard; then exit 0; fi
    link_disconnect "$LINK_DOWN_SEC"
    apply_policy_route
    echo "✓ ${IFACE} link disconnect ${LINK_DOWN_SEC}s tier2"
    ;;
  3)
    link_disconnect 60
    if try_at_mode hard; then exit 0; fi
    apply_policy_route
    echo "✓ ${IFACE} link disconnect 60s tier3 (AT 실패)"
    ;;
  *)
    echo "unknown tier: $TIER" >&2
    exit 1
    ;;
esac
