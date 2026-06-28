#!/bin/bash
# SOCKS5 동글 프록시 진단 (Playwright ERR_SOCKS_CONNECTION_FAILED 대응)
# Usage: bash check-socks-proxy.sh [port ...]   # 기본 10001~10007
#
# naver: HEAD TTFB (HUMA modem-socks-probe 와 동일) — GET full page 는 느려도 HTTP 200 오탐

PORTS=("$@")
if [ "$#" -eq 0 ]; then
  PORTS=(10001 10002 10003 10004 10005 10006 10007)
fi

NAVER_SLOW_SEC="${HUMA_SOCKS_NAVER_SLOW_SEC:-8}"

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
echo "=== SOCKS5 curl 테스트 (naver.com HEAD TTFB) ==="
for p in "${PORTS[@]}"; do
  if ! ss -tln 2>/dev/null | grep -q ":${p} "; then
    echo "  ✗ :${p} → NOT LISTEN"
    continue
  fi
  RAW=$(curl -4 -s -o /dev/null -w '%{http_code}:%{time_starttransfer}:%{time_total}' \
    -I --connect-timeout 10 --max-time 25 \
    --socks5-hostname "127.0.0.1:${p}" https://www.naver.com 2>/dev/null || echo 'FAIL')
  if [ "$RAW" = "FAIL" ] || [ -z "$RAW" ]; then
    echo "  ✗ :${p} → FAIL (proxy 미동작 또는 타임아웃)"
    continue
  fi
  CODE="${RAW%%:*}"
  REST="${RAW#*:}"
  TTFB="${REST%%:*}"
  TOTAL="${REST##*:}"
  if [ "$CODE" = "200" ] || [ "$CODE" = "301" ] || [ "$CODE" = "302" ]; then
    slow_flag=""
    if awk -v t="$TOTAL" -v lim="$NAVER_SLOW_SEC" 'BEGIN { exit (t + 0 > lim + 0) ? 0 : 1 }'; then
      slow_flag=" ⚠ 느림(>${NAVER_SLOW_SEC}s)"
    fi
    echo "  ✓ :${p} → HTTP ${CODE} ttfb=${TTFB}s total=${TOTAL}s${slow_flag}"
  else
    echo "  ✗ :${p} → HTTP ${CODE} (total=${TOTAL}s)"
  fi
done
