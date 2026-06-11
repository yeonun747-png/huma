#!/bin/bash
# C-Rank 직결 실폰 — 슬롯6(:10006)·슬롯7(:10007)
# ADB serial(/etc/huma/phone-crank-slots.conf) + USB 경로로 enx 테더 iface 매칭
#
# Usage:
#   sudo bash restore-phone-crank.sh          # 로그 + stdout에 iface:port (복구 스크립트용)
#   sudo bash restore-phone-crank.sh --quiet  # iface:port 만 출력

set -euo pipefail

QUIET=false
[ "${1:-}" = "--quiet" ] && QUIET=true

PHONE_CONF="${HUMA_PHONE_CRANK_CONF:-/etc/huma/phone-crank-slots.conf}"
PHONE_SLOTS=(6 7)
PHONE_PORTS=(10006 10007)
PHONE_LABELS=("C-Rank 폰A" "C-Rank 폰B")

log() {
  $QUIET || echo "$@" >&2
}

ADB="$(command -v adb || true)"
if [ -z "$ADB" ]; then
  log "오류: adb 없음 (apt install adb)"
  exit 1
fi

read_serial_from_conf() {
  local slot="$1"
  [ -f "$PHONE_CONF" ] || return 1
  grep -E "^[[:space:]]*${slot}=" "$PHONE_CONF" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]'
}

adb_usb_suffix() {
  local serial="$1"
  "$ADB" devices -l 2>/dev/null | awk -v s="$serial" '
    $1 == s {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^usb:/) { sub(/^usb:/, "", $i); print $i; exit }
      }
    }'
}

iface_for_serial() {
  local serial="$1"
  local usb_suffix="$2"
  local iface dev
  [ -n "$usb_suffix" ] || return 1
  for iface in $(ip -br link 2>/dev/null | awk '/^(enx|eth)/ {print $1}'); do
    dev="$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null || true)"
    [ -z "$dev" ] && continue
    # 192.168.*.100 = 허브 ZTE 동글 RNDIS — 실폰 테더(192.168.42.x 등)는 허용
    local ip_full
    ip_full="$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)"
    if [[ "${ip_full:-}" =~ ^192\.168\.[0-9]+\.100$ ]]; then
      continue
    fi
    if [[ "$dev" == *"/${usb_suffix}/"* ]] || [[ "$dev" == *"/${usb_suffix}:"* ]]; then
      echo "$iface"
      return 0
    fi
  done
  return 1
}

ensure_rndis_tether() {
  local serial="$1"
  local iface="$2"
  local ip_full
  ip_full="$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)"
  if [ -n "$ip_full" ]; then
    return 0
  fi
  log "  → ${serial} rndis 테더링 활성화"
  "$ADB" -s "$serial" shell svc usb setFunctions rndis 2>/dev/null || true
  sleep 12
  for _ in $(seq 1 10); do
    ip_full="$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)"
    [ -n "$ip_full" ] && return 0
    sleep 3
  done
  return 1
}

discover_serials_auto() {
  mapfile -t lines < <("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}')
  if [ "${#lines[@]}" -eq 0 ]; then
    return 1
  fi
  local sorted=()
  local serial usb
  for serial in "${lines[@]}"; do
    usb="$(adb_usb_suffix "$serial")"
    [ -n "$usb" ] || continue
    sorted+=("${usb}|${serial}")
  done
  if [ "${#sorted[@]}" -eq 0 ]; then
    return 1
  fi
  IFS=$'\n' sorted=($(printf '%s\n' "${sorted[@]}" | sort -t'|' -k1,1))
  unset IFS
  AUTO_SERIALS=()
  for entry in "${sorted[@]}"; do
    AUTO_SERIALS+=("${entry#*|}")
    [ "${#AUTO_SERIALS[@]}" -ge 2 ] && break
  done
}

log "=== C-Rank 실폰 (슬롯6·7) ==="

SERIALS=()
for i in "${!PHONE_SLOTS[@]}"; do
  slot="${PHONE_SLOTS[$i]}"
  ser="$(read_serial_from_conf "$slot" || true)"
  SERIALS+=("${ser:-}")
done

if [ -z "${SERIALS[0]:-}" ] && [ -z "${SERIALS[1]:-}" ]; then
  log "  ⚠ ${PHONE_CONF} 없음 — ADB USB 경로 순으로 자동 배정"
  AUTO_SERIALS=()
  if ! discover_serials_auto; then
    log "  ✗ 온라인 ADB 기기 없음"
    exit 1
  fi
  SERIALS=("${AUTO_SERIALS[0]:-}" "${AUTO_SERIALS[1]:-}")
fi

ROUTE_OUT=()
CONF_OUT=()
OK=0

for i in "${!PHONE_SLOTS[@]}"; do
  slot="${PHONE_SLOTS[$i]}"
  port="${PHONE_PORTS[$i]}"
  label="${PHONE_LABELS[$i]}"
  serial="${SERIALS[$i]:-}"

  if [ -z "$serial" ]; then
    log "  ✗ 슬롯${slot} ${label} — serial 미설정·미연결"
    continue
  fi

  if ! "$ADB" -s "$serial" get-state 2>/dev/null | grep -qx 'device'; then
    log "  ✗ 슬롯${slot} ${label} — adb offline (${serial})"
    continue
  fi

  usb="$(adb_usb_suffix "$serial")"
  iface="$(iface_for_serial "$serial" "$usb" || true)"
  if [ -z "$iface" ]; then
    log "  ✗ 슬롯${slot} ${label} — 테더 iface 없음 (usb:${usb:-?})"
    continue
  fi

  ip link set "$iface" up 2>/dev/null || true
  while ip route del default dev "$iface" 2>/dev/null; do :; done

  if ! ensure_rndis_tether "$serial" "$iface"; then
    log "  ✗ 슬롯${slot} ${label} — 테더 IP 없음 (${iface})"
    continue
  fi

  ip_full="$(ip -4 addr show dev "$iface" | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1)"
  ROUTE_OUT+=("${iface}:${port}")
  CONF_OUT+=("${slot}=${iface}")
  log "  ✓ 슬롯${slot} ${label} ${serial} ${iface} ${ip_full} → :${port}"
  OK=$((OK + 1))
done

if [ "$OK" -eq 0 ]; then
  log "  ✗ 매핑된 실폰 0 — ${PHONE_CONF} · adb devices · USB 디버깅 확인"
  exit 1
fi

for mapping in "${ROUTE_OUT[@]}"; do
  echo "$mapping"
done

# serial 캐시 (reconnect 스크립트용)
mkdir -p /etc/huma
{
  echo "# restore-phone-crank.sh $(date -Iseconds)"
  for i in "${!PHONE_SLOTS[@]}"; do
    slot="${PHONE_SLOTS[$i]}"
    serial="${SERIALS[$i]:-}"
    [ -n "$serial" ] && echo "${slot}=${serial}"
  done
} > /etc/huma/phone-crank-serials.cache
