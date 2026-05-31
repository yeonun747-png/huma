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
    val=$(grep -E "^${name}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [ -n "$val" ] && [ "$val" != "your_client_id" ] && [ "$val" != "your_refresh_token" ]; then
      echo "✓ $name"
      return 0
    fi
  fi
  echo "✗ $name (미설정 또는 placeholder)"
  return 1
}

echo "=== AdSense env ($(pwd)/$ENV_FILE) ==="
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
  echo "→ 4개 중 $missing 개 누락. 수정 후: npm run build --workspace=@huma/server && 서버 재시작"
  exit 1
fi

echo ""
echo "→ env OK. 서버 재시작 후 /api/monetization/stats 확인"
