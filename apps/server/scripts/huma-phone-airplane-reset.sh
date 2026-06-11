#!/bin/bash
# Samsung 등 — ADB 비행기모드로 LTE 공인 IP 교체 + USB 테더링(rndis) 복구
#
# Usage: sudo bash huma-phone-airplane-reset.sh <adb_serial> <tether_iface> [proxy_port]
# 예: sudo bash huma-phone-airplane-reset.sh RF9R202012L enx1a6b08693d5e 10006

set -euo pipefail

SERIAL="${1:?adb serial required}"
IFACE="${2:?tether iface required}"
PORT="${3:-}"

DIR="$(cd "$(dirname "$0")" && pwd)"
ADB="$(command -v adb || true)"
[ -n "$ADB" ] || { echo "FAIL adb not found"; exit 1; }

if ! "$ADB" -s "$SERIAL" get-state 2>/dev/null | grep -qx 'device'; then
  echo "FAIL adb device ${SERIAL} not online"
  exit 1
fi

"$ADB" -s "$SERIAL" shell cmd connectivity airplane-mode enable
sleep "${HUMA_PHONE_AIRPLANE_ON_SEC:-12}"
"$ADB" -s "$SERIAL" shell cmd connectivity airplane-mode disable
sleep "${HUMA_PHONE_AIRPLANE_OFF_SEC:-18}"
"$ADB" -s "$SERIAL" shell svc usb setFunctions rndis 2>/dev/null || true
sleep "${HUMA_PHONE_RNDIS_SETTLE_SEC:-22}"

IP=""
for _ in $(seq 1 18); do
  IP="$(ip -4 addr show dev "$IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)"
  [ -n "$IP" ] && break
  sleep 3
done

if [ -z "$IP" ]; then
  echo "FAIL ${IFACE} no IPv4 after airplane (serial ${SERIAL})"
  exit 1
fi

if [ -n "$PORT" ]; then
  bash "$DIR/huma-dongle-routes.sh" "${IFACE}:${PORT}"
  if [ -f /etc/3proxy/3proxy.cfg ]; then
    if grep -qE "^socks -p${PORT} " /etc/3proxy/3proxy.cfg; then
      sed -i -E "s|^(socks -p${PORT} ).*|\\1-i127.0.0.1 -e${IP}|" /etc/3proxy/3proxy.cfg
    else
      echo "socks -p${PORT} -i127.0.0.1 -e${IP}" >> /etc/3proxy/3proxy.cfg
    fi
    systemctl reload 3proxy 2>/dev/null || systemctl restart 3proxy 2>/dev/null || true
  fi
fi

PUB="$(curl -4 -s --max-time 15 --interface "$IP" https://api.ipify.org 2>/dev/null || echo "")"
echo "OK ${SERIAL} ${IFACE} ${IP} public=${PUB:-?}"
