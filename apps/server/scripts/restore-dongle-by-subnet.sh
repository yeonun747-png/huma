#!/bin/bash
# ZTE 동글 — 허브 포스팅 5대: USB 경로 순 → 슬롯1~5 (:10001~10005)
#   슬롯1~3 연운1~3 · 슬롯4 파나나 · 슬롯5 퀴즈
# C-Rank는 i7 직결 실폰 — 동글 슬롯6·7 미사용
#
# eth/enx 이름·192.168.{n}.100 서브넷이 바뀌어도 restore 시 재매핑
#
# Usage: sudo bash restore-dongle-by-subnet.sh
# 사전: isc-dhcp-client (dhclient), 동글 USB 인식·LTE 연결

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

POSTING_PORTS=(10001 10002 10003 10004 10005)
SLOT_LABELS=("연운1" "연운2" "연운3" "파나나" "퀴즈")
MAX_POSTING_DONGLES=5

dongle_usb_path() {
  local iface="$1"
  readlink -f "/sys/class/net/${iface}/device" 2>/dev/null || echo "zz-fallback-${iface}"
}

# ZTE 허브 동글만 192.168.{n}.100 — 실폰 RNDIS(192.168.42.x 등)는 제외
is_rndis_dongle_ip() {
  local ip="$1"
  [[ "$ip" =~ ^192\.168\.[0-9]+\.100$ ]]
}

is_iface_usb_present() {
  local iface="$1" dev
  dev=$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null || true)
  [ -n "$dev" ] && [ -e "$dev" ]
}

is_iface_carrier_up() {
  local iface="$1" carrier
  carrier=$(cat "/sys/class/net/${iface}/carrier" 2>/dev/null || echo 0)
  [ "$carrier" = "1" ]
}

dongle_guess_gateway() {
  local ip="$1"
  echo "${ip%.*}.1"
}

# USB 분리 후에도 eth 이름·192.168.*.100 IP가 남는 고스트 iface 제외
is_live_zte_dongle_iface() {
  local iface="$1" ip="$2" gw
  if ! is_iface_usb_present "$iface"; then
    echo "  ⊘ ${iface} ${ip} — 고스트 (USB device 없음), 스킵"
    return 1
  fi
  if ! is_iface_carrier_up "$iface"; then
    echo "  ⊘ ${iface} ${ip} — 고스트 (carrier down), 스킵"
    return 1
  fi
  gw=$(dongle_guess_gateway "$ip")
  if ! ping -c 1 -W 2 -I "$iface" "$gw" >/dev/null 2>&1; then
    echo "  ⊘ ${iface} ${ip} — 고스트 (gw ${gw} unreachable), 스킵"
    return 1
  fi
  return 0
}

# 동시 dhclient 시 LTE bearer 동시 attach → 처리량 급락 방지 (동글 1대씩)
DONGLE_DHCP_STAGGER_SEC="${HUMA_DONGLE_DHCP_STAGGER_SEC:-2}"

echo "=== 1) DHCP (eth/enx) — 순차 dhclient (${DONGLE_DHCP_STAGGER_SEC}s 간격) ==="
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
    sleep "$DONGLE_DHCP_STAGGER_SEC"
  fi
  while ip route del default dev "$iface" 2>/dev/null; do :; done
done

echo ""
ip -br -4 a | grep -E '^(eth|enx)' || true

echo ""
echo "=== 2) USB 경로 순 → 포스팅 슬롯 1~5 (:10001~10005) ==="
SORTED_LINES=()
for iface in "${IFACES[@]}"; do
  ip_full=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1)
  [ -z "$ip_full" ] && continue
  if ! is_rndis_dongle_ip "$ip_full"; then
    echo "  ⊘ ${iface} ${ip_full} — 실폰 테더(ZTE 동글 192.168.*.100 아님), 스킵"
    continue
  fi
  if ! is_live_zte_dongle_iface "$iface" "$ip_full"; then
    continue
  fi
  usb=$(dongle_usb_path "$iface")
  SORTED_LINES+=("${usb}|${iface}|${ip_full}")
done

if [ "${#SORTED_LINES[@]}" -eq 0 ]; then
  echo "오류: 192.168.* RNDIS 동글 없음"
  exit 1
fi

IFS=$'\n' SORTED_LINES=($(printf '%s\n' "${SORTED_LINES[@]}" | sort -t'|' -k1,1))
unset IFS

if [ "${#SORTED_LINES[@]}" -gt "$MAX_POSTING_DONGLES" ]; then
  echo "  ⚠ 동글 ${#SORTED_LINES[@]}대 감지 — 포스팅 ${MAX_POSTING_DONGLES}대만 슬롯1~5에 배정 (C-Rank 동글은 허브에서 제거 권장)"
fi

ROUTE_ARGS=()
CONF_LINES=()
OK=0

for i in "${!SORTED_LINES[@]}"; do
  [ "$i" -ge "$MAX_POSTING_DONGLES" ] && break
  line="${SORTED_LINES[$i]}"
  iface="${line#*|}"
  iface="${iface%%|*}"
  ip_full="${line##*|}"
  port="${POSTING_PORTS[$i]}"
  slot=$((i + 1))
  label="${SLOT_LABELS[$i]}"
  ROUTE_ARGS+=("${iface}:${port}")
  CONF_LINES+=("${slot}=${iface}")
  echo "  ✓ 슬롯${slot} ${label} ${iface} ${ip_full} → :${port}"
  OK=$((OK + 1))
done

for ((j = OK; j < MAX_POSTING_DONGLES; j++)); do
  slot=$((j + 1))
  echo "  ✗ 슬롯${slot} ${SLOT_LABELS[$j]} — 동글 미연결"
done

if [ "$OK" -eq 0 ]; then
  echo "오류: 매핑된 동글 없음"
  exit 1
fi

PHONE_ROUTE_ARGS=()
PHONE_CONF_LINES=()
echo ""
echo "=== 2b) C-Rank 직결 실폰 슬롯6~7 (:10006~:10007) ==="
set +e
mapfile -t PHONE_ROUTE_ARGS < <(bash "$DIR/restore-phone-crank.sh" --quiet)
phone_rc=$?
set -e
if [ "$phone_rc" -ne 0 ] || [ "${#PHONE_ROUTE_ARGS[@]}" -eq 0 ]; then
  echo "  ⚠ 실폰 미연결 — C-Rank 슬롯6·7 스킵 (포스팅만 복구)"
  PHONE_ROUTE_ARGS=()
else
  for mapping in "${PHONE_ROUTE_ARGS[@]}"; do
    [ -z "$mapping" ] && continue
    iface="${mapping%%:*}"
    port="${mapping##*:}"
    case "$port" in
      10006) PHONE_CONF_LINES+=("6=${iface}") ;;
      10007) PHONE_CONF_LINES+=("7=${iface}") ;;
    esac
  done
fi

ALL_ROUTE_ARGS=("${ROUTE_ARGS[@]}" "${PHONE_ROUTE_ARGS[@]}")

echo ""
echo "=== 3) policy routing 정리 + 적용 ==="
# conf에 없는 stale 192.168.*.100 source rule 제거 (동글 분리 후 고스트 route)
while read -r line; do
  from_ip=$(echo "$line" | grep -oP '(?<=from )192\.168\.[0-9]+\.[0-9]+' || true)
  [ -n "$from_ip" ] || continue
  is_rndis_dongle_ip "$from_ip" || continue
  keep=0
  for entry in "${SORTED_LINES[@]}"; do
    [ "${entry##*|}" = "$from_ip" ] && keep=1 && break
  done
  if [ "$keep" -eq 0 ]; then
    while ip rule del from "${from_ip}/32" 2>/dev/null; do
      echo "  ⊘ stale ip rule from ${from_ip}/32 제거"
    done
  fi
done < <(ip rule show 2>/dev/null | grep 'from 192\.168\.')

for tbl in 10001 10002 10003 10004 10005 10006 10007; do
  while ip rule del table "$tbl" 2>/dev/null; do :; done
done

bash "$DIR/huma-dongle-routes.sh" "${ALL_ROUTE_ARGS[@]}"

echo ""
echo "=== 4) 3proxy ==="
bash "$DIR/setup-proxy-socks.sh" "${ALL_ROUTE_ARGS[@]}"

mkdir -p /etc/huma
{
  echo "# restore-dongle-by-subnet.sh $(date -Iseconds)"
  echo "# 슬롯1~5 포스팅 동글 · 슬롯6~7 C-Rank 직결 실폰"
  printf '%s\n' "${CONF_LINES[@]}"
  printf '%s\n' "${PHONE_CONF_LINES[@]}"
} > /etc/huma/dongle-slot-interfaces.conf
echo ""
echo "→ /etc/huma/dongle-slot-interfaces.conf 갱신"

echo ""
echo "=== 5) SOCKS 테스트 ==="
PORTS=()
for arg in "${ALL_ROUTE_ARGS[@]}"; do PORTS+=("${arg##*:}"); done
bash "$DIR/check-socks-proxy.sh" "${PORTS[@]}"
