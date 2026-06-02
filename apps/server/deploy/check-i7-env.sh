#!/usr/bin/env bash
# i7 Ubuntu 운영 환경 점검 (타임존 · Slack · PM2)
set -euo pipefail

echo "=== Time zone (expect Asia/Seoul) ==="
timedatectl | grep -E 'Time zone|Local time' || true

if ! timedatectl | grep -q 'Time zone: Asia/Seoul'; then
  echo "WARN: KST가 아닙니다. 변경: sudo timedatectl set-timezone Asia/Seoul"
fi

echo ""
echo "=== SLACK_WEBHOOK_URL (apps/server/.env) ==="
ENV_FILE="${HUMA_ENV:-$HOME/huma/apps/server/.env}"
if [[ -f "$ENV_FILE" ]]; then
  if grep -qE '^SLACK_WEBHOOK_URL=https?://' "$ENV_FILE"; then
    echo "OK: SLACK_WEBHOOK_URL 설정됨"
  else
    echo "MISSING: $ENV_FILE 에 SLACK_WEBHOOK_URL=https://hooks.slack.com/... 추가 필요"
  fi
else
  echo "MISSING: $ENV_FILE 없음"
fi

echo ""
echo "=== PM2 ==="
pm2 status 2>/dev/null || echo "pm2 not running"

echo ""
echo "=== API health ==="
curl -sf http://127.0.0.1:3100/api/health && echo "" || echo "API not reachable on :3100"
