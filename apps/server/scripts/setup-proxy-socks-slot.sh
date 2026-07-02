#!/bin/bash
# 단일 슬롯 3proxy egress 갱신 — 전체 stop/restart 없이 reload
# Usage: sudo bash setup-proxy-socks-slot.sh eth0:10001

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: sudo bash setup-proxy-socks-slot.sh <iface>:<port>"
  exit 1
fi

MAPPING="$1"
IFACE="${MAPPING%%:*}"
PORT="${MAPPING##*:}"
CFG="/etc/3proxy/3proxy.cfg"

IP=$(ip -4 addr show dev "$IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
if [ -z "$IP" ]; then
  echo "오류: ${IFACE} IP 없음"
  exit 1
fi

mkdir -p /etc/3proxy
if [ ! -f "$CFG" ]; then
  {
    echo "auth none"
    echo "allow *"
  } > "$CFG"
fi

LINE="socks -p${PORT} -i127.0.0.1 -e${IP}"
if grep -qE "^socks -p${PORT} " "$CFG" 2>/dev/null; then
  sed -i -E "s|^socks -p${PORT} .*|${LINE}|" "$CFG"
else
  echo "$LINE" >> "$CFG"
fi

if systemctl is-active 3proxy >/dev/null 2>&1; then
  systemctl reload 3proxy 2>/dev/null || systemctl restart 3proxy
else
  systemctl enable 3proxy 2>/dev/null || true
  systemctl restart 3proxy 2>/dev/null || service 3proxy restart
fi

sleep 1
if ss -tln | grep -q ":${PORT} "; then
  echo "✓ ${IFACE} (${IP}) → socks :${PORT} reload"
else
  echo "✗ :${PORT} NOT LISTEN"
  exit 1
fi
