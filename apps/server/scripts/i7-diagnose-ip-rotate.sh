#!/bin/bash
# i7 C-Rank 공인 IP 교체 진단 (일회성)
set -uo pipefail

echo "=== $(date -Iseconds) ==="
echo "--- host egress ---"
curl -4 -s --max-time 8 https://api.ipify.org || echo FAIL
echo

echo "--- dongle-slot-interfaces.conf ---"
cat /etc/huma/dongle-slot-interfaces.conf 2>/dev/null || echo MISSING

echo "--- dongle-at-ports.conf ---"
cat /etc/huma/dongle-at-ports.conf 2>/dev/null || echo MISSING

echo "--- interfaces (eth/enx) ---"
ip -br -4 a | grep -E '^(eth|enx)' || true

echo "--- 3proxy socks lines ---"
grep -E '^(socks|proxy) ' /etc/3proxy/3proxy.cfg 2>/dev/null || echo MISSING

echo "--- redis AT cache ---"
if command -v redis-cli >/dev/null; then
  redis-cli KEYS 'dongle_at_port:slot*' 2>/dev/null || true
  for k in $(redis-cli KEYS 'dongle_at_port:slot*' 2>/dev/null); do
    echo "  $k=$(redis-cli GET "$k" 2>/dev/null)"
  done
else
  echo redis-unavailable
fi

echo "--- SOCKS ipify per port ---"
for p in 10001 10002 10003 10004 10005 10006 10007; do
  ip=$(curl -4 -s --max-time 12 --connect-timeout 8 --socks5-hostname "127.0.0.1:${p}" https://api.ipify.org 2>/dev/null || echo FAIL)
  echo "  :${p} → ${ip}"
done

echo "--- pm2 lte-reset (last 30) ---"
grep '\[lte-reset\]' ~/.pm2/logs/huma-server-out.log 2>/dev/null | tail -30 || echo none

echo "--- recent C-Rank IP rotate errors ---"
grep -F '공인 IP 동일' ~/.pm2/logs/huma-server-out.log 2>/dev/null | tail -8 || true

echo "--- AT probe (first 3 ifaces with IP) ---"
n=0
while read -r iface _; do
  ip=$(ip -4 addr show dev "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | head -1)
  [ -z "$ip" ] && continue
  n=$((n + 1))
  [ "$n" -gt 3 ] && break
  echo "  iface=${iface} ip=${ip}"
  net_leaf=$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null | grep -oE '[0-9]+-[0-9.]+' | tail -1 || true)
  echo "    usb_leaf=${net_leaf:-?}"
  found=0
  for t in /dev/ttyUSB* /dev/ttyACM*; do
    [ -e "$t" ] || continue
    tty_leaf=$(readlink -f "/sys/class/tty/$(basename "$t")/device" 2>/dev/null | grep -oE '[0-9]+-[0-9.]+' | tail -1 || true)
    [ "$tty_leaf" = "$net_leaf" ] || continue
    resp=$(sudo -n bash -c "stty -F '$t' 115200 raw -echo min 0 time 10 2>/dev/null; printf 'AT\r' > '$t'; sleep 0.4; timeout 1 head -c 80 < '$t'" 2>/dev/null || true)
    if printf '%s' "$resp" | grep -qi OK; then
      echo "    AT OK: $t"
      found=1
      break
    fi
  done
  [ "$found" -eq 0 ] && echo "    AT OK: NONE (auto-detect fail)"
done < <(ip -br link | awk '/^(eth|enx)/ {print $1}')
