#!/bin/bash
# C-Rank 실폰 — 테더 IP·3proxy·policy route 복구 (비행기모드 없음)
# Usage: sudo bash huma-phone-ensure-tether.sh <adb_serial> <iface> <proxy_port>

set -euo pipefail

SERIAL="${1:?serial}"
IFACE="${2:?iface}"
PORT="${3:?proxy_port}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ADB="$(command -v adb || true)"
[ -n "$ADB" ] || { echo "FAIL adb missing"; exit 1; }

if ! "$ADB" -s "$SERIAL" get-state 2>/dev/null | grep -qx 'device'; then
  echo "FAIL adb offline ${SERIAL}"
  exit 1
fi

ip link set "$IFACE" up 2>/dev/null || true

IP="$(ip -4 addr show dev "$IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)"
if [ -z "$IP" ]; then
  "$ADB" -s "$SERIAL" shell svc usb setFunctions rndis 2>/dev/null || true
  sleep 12
  for _ in $(seq 1 12); do
    IP="$(ip -4 addr show dev "$IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)"
    [ -n "$IP" ] && break
    sleep 3
  done
fi

if [ -z "$IP" ]; then
  echo "FAIL ${IFACE} no IPv4 (serial ${SERIAL})"
  exit 1
fi

bash "$DIR/huma-dongle-routes.sh" "${IFACE}:${PORT}"

if [ -f /etc/3proxy/3proxy.cfg ]; then
  if grep -qE "^socks -p${PORT} " /etc/3proxy/3proxy.cfg; then
    sed -i -E "s|^(socks -p${PORT} ).*|\\1-i127.0.0.1 -e${IP}|" /etc/3proxy/3proxy.cfg
  else
    echo "socks -p${PORT} -i127.0.0.1 -e${IP}" >> /etc/3proxy/3proxy.cfg
  fi
  systemctl reload 3proxy 2>/dev/null || systemctl restart 3proxy 2>/dev/null || true
fi

echo "OK ${SERIAL} ${IFACE} ${IP} :${PORT}"
