#!/bin/bash
# 3proxy SOCKS5 — Playwright socks5://127.0.0.1:PORT 용 (HTTP proxy 아님)
# ZTE RNDIS(eth/enx) · wwan 모두 지원
#
# Usage:
#   sudo bash setup-proxy-socks.sh eth0:10001 eth1:10002 ...
#   sudo bash setup-proxy-socks.sh   # 아래 DEFAULT_SLOTS 사용
#
# i7 ZTE 7동글 예:
#   sudo bash setup-proxy-socks.sh \
#     eth0:10001 eth1:10002 eth2:10003 eth3:10004 \
#     eth4:10005 eth5:10006 enx344b50000000:10007

set -e

DEFAULT_SLOTS=(
  eth0:10001 eth1:10002 eth2:10003 eth3:10004
  eth4:10005 eth5:10006 enx344b50000000:10007
)

if [ "$#" -gt 0 ]; then
  SLOTS=("$@")
else
  SLOTS=("${DEFAULT_SLOTS[@]}")
fi

CFG="/etc/3proxy/3proxy.cfg"
mkdir -p /etc/3proxy

{
  echo "auth none"
  echo "allow *"
} > "$CFG"

OK=0
for mapping in "${SLOTS[@]}"; do
  IFACE="${mapping%%:*}"
  PORT="${mapping##*:}"
  IP=$(ip -4 addr show "$IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
  if [ -n "$IP" ]; then
    echo "socks -p${PORT} -i127.0.0.1 -e${IP}" >> "$CFG"
    echo "✓ ${IFACE} (${IP}) → socks :${PORT}"
    OK=$((OK + 1))
  else
    echo "⚠ ${IFACE} — IP 없음 (동글 미연결?)"
  fi
done

if [ "$OK" -eq 0 ]; then
  echo "오류: 유효한 인터페이스 없음. ip -br a 로 확인 후 eth0:10001 형식으로 인자 전달"
  exit 1
fi

systemctl enable 3proxy 2>/dev/null || true
systemctl restart 3proxy 2>/dev/null || service 3proxy restart
sleep 2
echo ""
echo "※ policy routing 미설정 시 SOCKS 실패 — sudo bash $(dirname "$0")/huma-dongle-routes.sh"
echo ""
echo "3proxy SOCKS 재시작 완료 (${OK}슬롯). 테스트:"
for mapping in "${SLOTS[@]}"; do
  PORT="${mapping##*:}"
  if ss -tln | grep -q ":${PORT} "; then
    echo "  ✓ :${PORT} LISTEN"
  else
    echo "  ✗ :${PORT} NOT LISTEN"
  fi
done
