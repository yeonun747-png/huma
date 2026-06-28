#!/bin/bash
# SOCKS5 동글 프록시 진단 (Playwright ERR_SOCKS_CONNECTION_FAILED 대응)
# Usage: bash check-socks-proxy.sh [port ...]   # 기본 10001~10007

PORTS=("$@")
if [ "$#" -eq 0 ]; then
  PORTS=(10001 10002 10003 10004 10005 10006 10007)
fi

echo "=== 3proxy 서비스 ==="
systemctl is-active 3proxy 2>/dev/null || service 3proxy status 2>/dev/null | head -3 || echo "3proxy 상태 확인 불가"

echo ""
echo "=== /etc/3proxy/3proxy.cfg (socks/proxy 줄) ==="
grep -E '^(socks|proxy) ' /etc/3proxy/3proxy.cfg 2>/dev/null || echo "(설정 파일 없음)"

echo ""
echo "=== 포트 LISTEN ==="
for p in "${PORTS[@]}"; do
  if ss -tln | grep -q ":${p} "; then
    echo "  ✓ :${p}"
  else
    echo "  ✗ :${p} NOT LISTEN"
  fi
done

echo ""
echo "=== SOCKS5 curl 테스트 (naver.com) ==="
for p in "${PORTS[@]}"; do
  CODE=$(curl -4 -s -o /dev/null -w '%{http_code}' --connect-timeout 15 --max-time 45 --socks5-hostname "127.0.0.1:${p}" https://www.naver.com 2>/dev/null)
  CODE=${CODE:-FAIL}
  if [ "$CODE" = "200" ] || [ "$CODE" = "301" ] || [ "$CODE" = "302" ]; then
    echo "  ✓ :${p} → HTTP ${CODE}"
  else
    echo "  ✗ :${p} → ${CODE} (proxy 미동작 또는 HTTP proxy로 설정됨 — socks 필요)"
  fi
done
