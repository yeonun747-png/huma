#!/bin/bash
# i7에서 AdSense env 로드 여부 확인 (값은 출력하지 않음)
# Usage: bash apps/server/scripts/check-adsense-env.sh

set -e
cd "$(dirname "$0")/.."
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE 없음 ($(pwd))"
  exit 1
fi

check_var() {
  local name="$1"
  if grep -qE "^${name}=" "$ENV_FILE" 2>/dev/null; then
    local val
    val=$(grep -E "^${name}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed 's/^"//;s/"$//')
    if [ -n "$val" ] && [ "$val" != "your_client_id" ] && [ "$val" != "your_refresh_token" ]; then
      echo "✓ $name"
      return 0
    fi
  fi
  echo "✗ $name (미설정 또는 placeholder)"
  return 1
}

echo "=== AdSense .env 파일 ($(pwd)/$ENV_FILE) ==="
missing=0
for v in ADSENSE_CLIENT_ID ADSENSE_CLIENT_SECRET ADSENSE_REFRESH_TOKEN ADSENSE_ACCOUNT_ID; do
  check_var "$v" || missing=$((missing + 1))
done

for v in GOOGLE_ADSENSE_CLIENT_ID GOOGLE_ADSENSE_CLIENT_SECRET GOOGLE_ADSENSE_REFRESH_TOKEN ADSENSE_PUBLISHER_ID GOOGLE_ADSENSE_PUBLISHER_ID; do
  if grep -qE "^${v}=" "$ENV_FILE" 2>/dev/null; then
    echo "  (별칭) $v 존재"
  fi
done

if [ "$missing" -gt 0 ]; then
  echo ""
  echo "→ .env 파일에 $missing 개 누락"
  exit 1
fi

echo ""
echo "=== AdSense 런타임 (Node process.env) ==="
node scripts/check-adsense-runtime.mjs

echo ""
if curl -sf http://127.0.0.1:3100/api/health >/dev/null 2>&1; then
  echo "✓ API 서버 실행 중 (3100)"
  echo "→ 로그 확인: tail -20 /tmp/huma-server.log | grep -i adsense"
else
  echo "✗ API 서버 미실행 — 빌드 후 재시작:"
  echo "  npm run build --workspace=@huma/server"
  echo "  kill \$(lsof -t -i:3100 -sTCP:LISTEN) 2>/dev/null; cd ~/huma/apps/server && nohup env DISPLAY=:99 node dist/index.js > /tmp/huma-server.log 2>&1 &"
  exit 1
fi
