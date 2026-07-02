#!/bin/bash
# 포스팅 동글 단일 슬롯 복구 — 다른 슬롯 3proxy·routing 유지
# Usage: sudo bash restore-dongle-slot.sh <slot 1-5>
#
# DHCP·USB 재매핑·policy route·3proxy reload 를 해당 슬롯만 수행

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="${HUMA_DONGLE_INTERFACES_CONF:-/etc/huma/dongle-slot-interfaces.conf}"

SLOT="${1:?slot 1-5 required}"
if ! [[ "$SLOT" =~ ^[1-5]$ ]]; then
  echo "오류: 슬롯은 1~5 (포스팅 동글)"
  exit 1
fi

PORT=$((10000 + SLOT))
SLOT_LABELS=("연운1" "연운2" "연운3" "파나나" "퀴즈")
LABEL="${SLOT_LABELS[$((SLOT - 1))]}"

dongle_usb_path() {
  readlink -f "/sys/class/net/${1}/device" 2>/dev/null || echo "zz-fallback-${1}"
}

is_rndis_dongle_ip() {
  [[ "$1" =~ ^192\.168\.[0-9]+\.100$ ]]
}

is_iface_usb_present() {
  local dev
  dev=$(readlink -f "/sys/class/net/${1}/device" 2>/dev/null || true)
  [ -n "$dev" ] && [ -e "$dev" ]
}

is_iface_carrier_up() {
  [ "$(cat "/sys/class/net/${1}/carrier" 2>/dev/null || echo 0)" = "1" ]
}

is_phone_tether_iface() {
  local iface="$1" ip="${2:-}"
  if [ -z "$ip" ]; then
    ip=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)
  fi
  [[ "${ip:-}" =~ ^192\.168\.42\. ]] && return 0
  [[ "${ip:-}" =~ ^10\. ]] && return 0
  if [[ "$iface" =~ ^enx ]] && [ -z "${ip:-}" ]; then
    return 0
  fi
  return 1
}

is_live_zte_dongle_iface() {
  local iface="$1" ip="$2" gw
  if ! is_iface_usb_present "$iface"; then
    echo "  ⊘ ${iface} ${ip} — 고스트 (USB 없음)"
    return 1
  fi
  if ! is_iface_carrier_up "$iface"; then
    echo "  ⊘ ${iface} ${ip} — 고스트 (carrier down)"
    return 1
  fi
  gw="${ip%.*}.1"
  if ! ping -c 1 -W 2 -I "$iface" "$gw" >/dev/null 2>&1; then
    echo "  ⊘ ${iface} ${ip} — 고스트 (gw ${gw})"
    return 1
  fi
  return 0
}

prepare_posting_iface() {
  local iface="$1"
  nmcli dev set "$iface" managed no 2>/dev/null || true
  ip link set "$iface" up 2>/dev/null || true
  if ! ip -4 addr show dev "$iface" 2>/dev/null | grep -q 'inet '; then
    dhclient -1 "$iface" 2>/dev/null || echo "  ⚠ ${iface} DHCP 실패"
    sleep "${HUMA_DONGLE_DHCP_STAGGER_SEC:-2}"
  fi
  while ip route del default dev "$iface" 2>/dev/null; do :; done
}

read_conf_iface() {
  local slot="$1"
  [ -f "$CONF" ] || return 1
  grep -E "^[[:space:]]*${slot}=" "$CONF" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]'
}

read_iface_ip() {
  ip -4 addr show dev "$1" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true
}

merge_conf_slot() {
  local slot="$1" iface="$2"
  mkdir -p /etc/huma
  local tmp lines=() found=0
  if [ -f "$CONF" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      local trimmed="${line%%#*}"
      trimmed="${trimmed//[[:space:]]/}"
      if [[ "$trimmed" =~ ^${slot}= ]]; then
        lines+=("${slot}=${iface}")
        found=1
      else
        lines+=("$line")
      fi
    done < "$CONF"
  fi
  if [ "$found" -eq 0 ]; then
    lines+=("${slot}=${iface}")
  fi
  {
    echo "# restore-dongle-slot.sh $(date -Iseconds) slot${slot}"
    printf '%s\n' "${lines[@]}"
  } > "$CONF"
}

echo "=== restore-dongle-slot.sh 슬롯${SLOT} ${LABEL} (:${PORT}) ==="

IFACES=()
while read -r iface _; do
  IFACES+=("$iface")
done < <(ip -br link | awk '/^(eth|enx)/ {print $1}')

SORTED_LINES=()
for iface in "${IFACES[@]}"; do
  ip_full=$(read_iface_ip "$iface")
  [ -z "$ip_full" ] && continue
  if ! is_rndis_dongle_ip "$ip_full"; then
    continue
  fi
  if ! is_live_zte_dongle_iface "$iface" "$ip_full"; then
    continue
  fi
  usb=$(dongle_usb_path "$iface")
  SORTED_LINES+=("${usb}|${iface}|${ip_full}")
done

if [ "${#SORTED_LINES[@]}" -eq 0 ]; then
  echo "오류: 라이브 ZTE 동글 없음"
  exit 1
fi

IFS=$'\n' SORTED_LINES=($(printf '%s\n' "${SORTED_LINES[@]}" | sort -t'|' -k1,1))
unset IFS

idx=$((SLOT - 1))
if [ "$idx" -ge "${#SORTED_LINES[@]}" ]; then
  echo "오류: 슬롯${SLOT} — USB 순서상 동글 미연결 (감지 ${#SORTED_LINES[@]}대)"
  exit 1
fi

line="${SORTED_LINES[$idx]}"
IFACE="${line#*|}"
IFACE="${IFACE%%|*}"
ip_full="${line##*|}"

OLD_IFACE=$(read_conf_iface "$SLOT" || true)
OLD_IP=""
if [ -n "${OLD_IFACE:-}" ]; then
  OLD_IP=$(read_iface_ip "$OLD_IFACE" || true)
fi

echo "  → ${IFACE} ${ip_full} (conf 이전: ${OLD_IFACE:-none} ${OLD_IP:-})"

echo ""
echo "=== 1) DHCP (해당 iface만) ==="
prepare_posting_iface "$IFACE"
ip_full=$(read_iface_ip "$IFACE")
if [ -z "$ip_full" ] || ! is_rndis_dongle_ip "$ip_full"; then
  echo "오류: ${IFACE} ZTE 동글 IP 없음"
  exit 1
fi

echo ""
echo "=== 2) conf 슬롯${SLOT} 갱신 ==="
merge_conf_slot "$SLOT" "$IFACE"

if [ -n "${OLD_IP:-}" ] && [ "$OLD_IP" != "$ip_full" ]; then
  while ip rule del from "${OLD_IP}/32" 2>/dev/null; do
    echo "  ⊘ stale ip rule from ${OLD_IP}/32"
  done
fi

echo ""
echo "=== 3) policy routing (슬롯${SLOT}만) ==="
bash "$DIR/huma-dongle-routes.sh" "${IFACE}:${PORT}"

echo ""
echo "=== 4) 3proxy reload (슬롯${SLOT}만) ==="
bash "$DIR/setup-proxy-socks-slot.sh" "${IFACE}:${PORT}"

echo ""
echo "✓ 슬롯${SLOT} ${LABEL} 복구 완료 — ${IFACE} ${ip_full} → :${PORT}"
