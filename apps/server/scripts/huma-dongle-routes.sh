#!/bin/bash
# ZTE RNDIS 동글 policy routing — 소스 IP별로 해당 동글 게이트웨이 경유
# 3proxy socks -e<IP> 와 curl --interface <IP> 가 동작하려면 필수
#
# Usage:
#   sudo bash huma-dongle-routes.sh eth0:10001 eth1:10002 ...
#   sudo bash huma-dongle-routes.sh   # DEFAULT_SLOTS

set -e

DEFAULT_SLOTS=(
  eth0:10001 eth1:10002 eth2:10003 eth3:10004 eth4:10005
  eth5:10006 enx344b50000000:10007
)

if [ "$#" -gt 0 ]; then
  SLOTS=("$@")
else
  SLOTS=("${DEFAULT_SLOTS[@]}")
fi

guess_gateway() {
  local iface="$1" ip="$2"
  local gw
  gw=$(ip route show dev "$iface" 2>/dev/null | awk '/^default/{print $3; exit}')
  if [ -n "$gw" ]; then
    echo "$gw"
    return
  fi
  # RNDIS: 보통 서브넷 .1
  echo "$ip" | awk -F. '{printf "%s.%s.%s.1\n", $1, $2, $3}'
}

setup_slot_route() {
  local iface="$1" table="$2"
  local ip_cidr ip_only gw link_route

  ip_cidr=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}/\d+' | head -1)
  if [ -z "$ip_cidr" ]; then
    echo "⚠ ${iface} — IP 없음, 스킵"
    return 1
  fi

  ip_only="${ip_cidr%%/*}"
  gw=$(guess_gateway "$iface" "$ip_only")

  while ip rule del from "${ip_only}/32" table "$table" 2>/dev/null; do :; done

  ip rule add from "${ip_only}/32" table "$table"
  ip route flush table "$table" 2>/dev/null || true
  ip route add default via "$gw" dev "$iface" table "$table"

  link_route=$(ip -4 route show dev "$iface" scope link 2>/dev/null | awk 'NR==1{print $1}')
  if [ -n "$link_route" ] && [ "$link_route" != "default" ]; then
    ip route add "$link_route" dev "$iface" scope link table "$table" 2>/dev/null || true
  fi

  echo "✓ ${iface} ${ip_only} → table ${table} via ${gw}"
}

OK=0
for mapping in "${SLOTS[@]}"; do
  IFACE="${mapping%%:*}"
  PORT="${mapping##*:}"
  if setup_slot_route "$IFACE" "$PORT"; then
    OK=$((OK + 1))
  fi
done

echo ""
echo "policy routing ${OK}슬롯 적용. 테스트:"
for mapping in "${SLOTS[@]}"; do
  IFACE="${mapping%%:*}"
  PORT="${mapping##*:}"
  IP=$(ip -4 addr show dev "$IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
  if [ -z "$IP" ]; then continue; fi
  OUT=$(curl -s --max-time 8 --interface "$IP" https://api.ipify.org 2>/dev/null || echo "FAIL")
  echo "  :${PORT} ${IFACE} (${IP}) → ${OUT}"
done
