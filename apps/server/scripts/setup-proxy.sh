#!/bin/bash
# 3proxy setup for HUMA Studio LTE dongles (기획서 v3.22 §7-13)
# Usage: sudo bash setup-proxy.sh

set -e

PORTS=(10001 10002 10003 10004 10005 10006 10007 10008 10009 10010)
IFACES=(wwan0 wwan1 wwan2 wwan3 wwan4 wwan5 wwan6 wwan7 wwan8 wwan9)

CFG="/etc/3proxy/3proxy.cfg"
echo "auth none" > "$CFG"
echo "allow *" >> "$CFG"

for i in "${!IFACES[@]}"; do
  IFACE="${IFACES[$i]}"
  PORT="${PORTS[$i]}"
  IP=$(ip -4 addr show "$IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
  if [ -n "$IP" ]; then
    echo "proxy -p${PORT} -i127.0.0.1 -e${IP}" >> "$CFG"
    ROLE="C-Rank 순환"
    if [ "$i" -lt 4 ]; then ROLE="포스팅 전용"; fi
    echo "✓ ${IFACE} → port ${PORT} → ${IP} (${ROLE})"
  else
    echo "⚠ ${IFACE} 없음 (동글 미연결 또는 인터페이스명 확인 필요)"
  fi
done

systemctl restart 3proxy 2>/dev/null || service 3proxy restart
echo "3proxy 재시작 완료 (포트 10001~10010)"
