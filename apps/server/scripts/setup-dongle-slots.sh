#!/bin/bash
# 물리 동글 1~5 → 192.168.3.{slot} · 3proxy · policy routing
# Usage: sudo bash setup-dongle-slots.sh [/etc/huma/dongle-slot-interfaces.conf]

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="${1:-/etc/huma/dongle-slot-interfaces.conf}"

read_iface() {
  local slot="$1"
  if [ -f "$CONF" ]; then
    local line
    line=$(grep -E "^[[:space:]]*${slot}=" "$CONF" | head -1)
    if [ -n "$line" ]; then
      echo "${line#*=}" | tr -d ' \r'
      return
    fi
  fi
  echo ""
}

setup_slot() {
  local slot="$1"
  local port="$((10000 + slot))"
  local bind_ip="192.168.3.${slot}"
  local iface
  iface=$(read_iface "$slot")

  if [ -z "$iface" ]; then
    echo "⚠ 동글 ${slot} — 인터페이스 미지정 (${CONF}에 ${slot}=ethX 추가)"
    return 1
  fi

  local actual_ip
  actual_ip=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
  if [ -z "$actual_ip" ]; then
    echo "⚠ 동글 ${slot} ${iface} — IP 없음"
    return 1
  fi

  local gw="${bind_ip}"
  while ip rule del from "${actual_ip}/32" table "${port}" 2>/dev/null; do :; done
  ip rule add from "${actual_ip}/32" table "${port}"
  ip route flush table "${port}" 2>/dev/null || true
  ip route add default via "${gw}" dev "${iface}" table "${port}" 2>/dev/null || \
    ip route add default via "${actual_ip%.*}.1" dev "${iface}" table "${port}"
  link_route=$(ip -4 route show dev "$iface" scope link 2>/dev/null | awk 'NR==1{print $1}')
  if [ -n "$link_route" ]; then
    ip route add "$link_route" dev "$iface" scope link table "${port}" 2>/dev/null || true
  fi

  echo "socks -p${port} -i127.0.0.1 -e${actual_ip}" >> /tmp/huma-3proxy-slots.cfg
  echo "✓ 동글 ${slot} ${iface} → SOCKS :${port} bind ${actual_ip} (관리 IP ${bind_ip})"
}

mkdir -p /etc/huma
if [ ! -f "$CONF" ]; then
  cp "${DIR}/dongle-slot-interfaces.example.conf" "$CONF"
  echo "→ ${CONF} 생성됨. 물리 동글 번호에 맞게 eth 이름을 채운 뒤 다시 실행하세요."
  exit 1
fi

{
  echo "auth none"
  echo "allow *"
} > /tmp/huma-3proxy-slots.cfg

OK=0
for slot in 1 2 3 4 5 6 7; do
  if setup_slot "$slot"; then OK=$((OK + 1)); fi
done

if [ "$OK" -eq 0 ]; then
  echo "오류: 설정된 슬롯 없음"
  exit 1
fi

cp /tmp/huma-3proxy-slots.cfg /etc/3proxy/3proxy.cfg
systemctl restart 3proxy
sleep 2
echo ""
echo "3proxy 재시작 (${OK}슬롯). 관리 IP: 192.168.3.1~.7"
