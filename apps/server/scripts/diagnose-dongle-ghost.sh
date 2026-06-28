#!/bin/bash
# 동글 고스트 iface·stale policy route·3proxy 불일치 진단
# Usage: bash diagnose-dongle-ghost.sh

set -uo pipefail

echo "=== $(date -Iseconds) dongle ghost 진단 ==="
echo ""

echo "--- 1) eth/enx + carrier + USB sysfs ---"
while read -r iface _; do
  ip_full=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)
  carrier=$(cat "/sys/class/net/${iface}/carrier" 2>/dev/null || echo '?')
  oper=$(cat "/sys/class/net/${iface}/operstate" 2>/dev/null || echo '?')
  dev=$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null || true)
  usb_ok=no
  if [ -n "$dev" ] && [ -e "$dev" ]; then usb_ok=yes; fi
  kind=other
  if [[ "${ip_full:-}" =~ ^192\.168\.[0-9]+\.100$ ]]; then kind=ZTE-dongle; fi
  if [[ "${ip_full:-}" =~ ^192\.168\.42\. ]] || [[ "${ip_full:-}" =~ ^10\. ]]; then kind=phone-tether; fi
  echo "  ${iface} ip=${ip_full:-none} carrier=${carrier} oper=${oper} usb=${usb_ok} kind=${kind}"
  if [ -n "$dev" ]; then echo "       dev=${dev}"; fi
done < <(ip -br link | awk '/^(eth|enx)/ {print $1}')

echo ""
echo "--- 2) dongle-slot-interfaces.conf ---"
cat /etc/huma/dongle-slot-interfaces.conf 2>/dev/null || echo "(없음)"

echo ""
echo "--- 3) ip rule (192.168.*.100 / table 10001~10007) ---"
ip rule show 2>/dev/null | grep -E 'from 192\.168\.|lookup 1000[1-7]' || echo "(해당 rule 없음)"

echo ""
echo "--- 4) 3proxy socks -e 바인딩 vs conf iface IP ---"
grep -E '^socks ' /etc/3proxy/3proxy.cfg 2>/dev/null || echo "(3proxy.cfg 없음)"
while read -r line; do
  trimmed=$(echo "$line" | sed 's/#.*//' | tr -d '[:space:]')
  [ -z "$trimmed" ] && continue
  slot="${trimmed%%=*}"
  iface="${trimmed#*=}"
  [ "$slot" -ge 1 ] 2>/dev/null && [ "$slot" -le 5 ] 2>/dev/null || continue
  conf_ip=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)
  carrier=$(cat "/sys/class/net/${iface}/carrier" 2>/dev/null || echo 0)
  port=$((10000 + slot))
  bind_ip=$(grep -E "^socks -p${port} " /etc/3proxy/3proxy.cfg 2>/dev/null | grep -oP '(?<=-e)\d+\.\d+\.\d+\.\d+' | head -1 || true)
  match=OK
  [ -z "$conf_ip" ] && match="GHOST-iface"
  [ "$carrier" != "1" ] && match="NO-CARRIER"
  [ -n "$bind_ip" ] && [ "$bind_ip" != "${conf_ip:-}" ] && match="3proxy-IP-mismatch"
  echo "  slot${slot} ${iface} conf_ip=${conf_ip:-none} 3proxy_e=${bind_ip:-none} → ${match}"
done < <(grep -E '^[1-5]=' /etc/huma/dongle-slot-interfaces.conf 2>/dev/null || true)

echo ""
echo "--- 5) 게이트웨이 ping (동글 .100) ---"
while read -r iface _; do
  ip_full=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1 || true)
  [[ "${ip_full:-}" =~ ^192\.168\.[0-9]+\.100$ ]] || continue
  gw="${ip_full%.*}.1"
  if ping -c 1 -W 2 -I "$iface" "$gw" >/dev/null 2>&1; then
    echo "  ✓ ${iface} ${ip_full} gw ${gw}"
  else
    echo "  ✗ ${iface} ${ip_full} gw ${gw} — 고스트/stale (물리 동글 없음 가능)"
  fi
done < <(ip -br link | awk '/^(eth|enx)/ {print $1}')

echo ""
echo "--- 6) SOCKS naver HEAD TTFB (HTTP코드:첫바이트초:총초) ---"
for p in 10001 10002 10003 10004 10005 10006 10007; do
  if ! ss -tln 2>/dev/null | grep -q ":${p} "; then
    echo "  :${p} NOT LISTEN"
    continue
  fi
  raw=$(curl -4 -s -o /dev/null -w '%{http_code}:%{time_starttransfer}:%{time_total}' \
    -I --connect-timeout 8 --max-time 20 \
    --socks5-hostname "127.0.0.1:${p}" https://www.naver.com 2>/dev/null || echo 'FAIL')
  echo "  :${p} → ${raw}"
done

echo ""
echo "--- 7) cf 2MB bulk (동글 처리량) ---"
for p in 10001 10002 10003 10004 10005; do
  if ! ss -tln 2>/dev/null | grep -q ":${p} "; then continue; fi
  raw=$(curl -4 -s -o /dev/null -w '%{speed_download}:%{time_total}' \
    --connect-timeout 10 --max-time 20 \
    --socks5-hostname "127.0.0.1:${p}" \
    "https://speed.cloudflare.com/__down?bytes=2000000" 2>/dev/null || echo 'FAIL')
  echo "  :${p} → speed=${raw}"
done

echo ""
echo "=== 해석 ==="
echo "  · conf에 iface 있는데 carrier=0 / gw ping 실패 → USB 분리 후 커널 고스트 eth"
echo "  · 3proxy -e IP ≠ 현재 iface IP → restore 없이 동글만 뽑았을 때 stale 3proxy"
echo "  · naver HEAD 200인데 time_total 10s+ → 연결됐지만 bulk/LTE 처리량 저하"
echo "  · check-socks-proxy.sh 는 예전엔 GET+코드만 봐서 느려도 ✓ — HEAD+시간으로 변경됨"
