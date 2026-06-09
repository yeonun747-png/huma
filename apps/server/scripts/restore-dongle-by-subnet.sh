#!/bin/bash
# ZTE 동글 — 서브넷(192.168.{octet}.100) 기준으로 policy routing + 3proxy 자동 복구
# eth/enx 이름이 재부팅마다 바뀌어도 동작 (고정 서브넷 → SOCKS 포트)
#
# Usage: sudo bash restore-dongle-by-subnet.sh
# 사전: isc-dhcp-client (dhclient), 동글 USB 인식·LTE 연결

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# 192.168.{3rd octet}.x → SOCKS 포트 (HUMA 고정 매핑)
declare -A OCTET_PORT=(
  [6]=10001
  [5]=10002
  [1]=10003
  [3]=10004
  [7]=10005
  [2]=10006
  [4]=10007
)

# 슬롯 번호(물리 스티커) = 3rd octet가 아님 — conf용 역매핑
declare -A PORT_SLOT=(
  [10001]=1
  [10002]=2
  [10003]=3
  [10004]=4
  [10005]=5
  [10006]=6
  [10007]=7
)

echo "=== 1) DHCP (eth/enx) ==="
IFACES=()
while read -r iface _; do
  IFACES+=("$iface")
done < <(ip -br link | awk '/^(eth|enx)/ {print $1}')

if [ "${#IFACES[@]}" -eq 0 ]; then
  echo "오류: eth/enx 인터페이스 없음. lsusb·USB 허브 확인"
  exit 1
fi

for iface in "${IFACES[@]}"; do
  nmcli dev set "$iface" managed no 2>/dev/null || true
  ip link set "$iface" up 2>/dev/null || true
  if ! ip -4 addr show dev "$iface" 2>/dev/null | grep -q 'inet '; then
    dhclient -1 "$iface" 2>/dev/null || echo "  ⚠ ${iface} DHCP 실패"
  fi
  # dhclient가 main table에 metric 없는 default route를 올림 → 호스트 전체가 동글 경유하는 것 방지
  while ip route del default dev "$iface" 2>/dev/null; do :; done
done

echo ""
ip -br -4 a | grep -E '^(eth|enx)' || true

echo ""
echo "=== 2) 서브넷 → 인터페이스 매핑 ==="
ROUTE_ARGS=()
CONF_LINES=()
OK=0

for iface in "${IFACES[@]}"; do
  ip_full=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1)
  [ -z "$ip_full" ] && echo "  ⚠ ${iface} — IP 없음" && continue

  octet=$(echo "$ip_full" | cut -d. -f3)
  port="${OCTET_PORT[$octet]:-}"
  if [ -z "$port" ]; then
    echo "  ⚠ ${iface} ${ip_full} — 알 수 없는 서브넷 (.${octet}.)"
    continue
  fi

  slot="${PORT_SLOT[$port]}"
  ROUTE_ARGS+=("${iface}:${port}")
  CONF_LINES+=("${slot}=${iface}")
  echo "  ✓ 슬롯${slot} ${iface} ${ip_full} → :${port}"
  OK=$((OK + 1))
done

if [ "$OK" -eq 0 ]; then
  echo "오류: 매핑된 동글 없음"
  exit 1
fi

echo ""
echo "=== 3) policy routing 정리 + 적용 ==="
for tbl in 10001 10002 10003 10004 10005 10006 10007; do
  while ip rule del table "$tbl" 2>/dev/null; do :; done
done

bash "$DIR/huma-dongle-routes.sh" "${ROUTE_ARGS[@]}"

echo ""
echo "=== 4) 3proxy ==="
bash "$DIR/setup-proxy-socks.sh" "${ROUTE_ARGS[@]}"

mkdir -p /etc/huma
{
  echo "# restore-dongle-by-subnet.sh $(date -Iseconds)"
  printf '%s\n' "${CONF_LINES[@]}" | sort -t '=' -k1,1n
} > /etc/huma/dongle-slot-interfaces.conf
echo ""
echo "→ /etc/huma/dongle-slot-interfaces.conf 갱신"

echo ""
echo "=== 5) SOCKS 테스트 ==="
PORTS=()
for arg in "${ROUTE_ARGS[@]}"; do PORTS+=("${arg##*:}"); done
bash "$DIR/check-socks-proxy.sh" "${PORTS[@]}"
