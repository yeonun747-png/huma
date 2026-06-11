#!/bin/bash
# i7 C-Rank 실폰 2대 — 1회 부트스트랩 (sudo 필요)
#
# Usage:
#   sudo HUMA_USER=songchunho bash ~/huma/apps/server/deploy/bootstrap-phone-crank-i7.sh
#   sudo HUMA_USER=songchunho bash ~/huma/apps/server/deploy/bootstrap-phone-crank-i7.sh --restore
#
# 전제: 실폰 2대 USB 직결 · ADB 디버깅 · USB 테더링 허용

set -euo pipefail

HUMA_USER="${HUMA_USER:-songchunho}"
HUMA_HOME="${HUMA_HOME:-/home/${HUMA_USER}}"
DEPLOY="${HUMA_HOME}/huma/apps/server/deploy"
SCRIPTS="${HUMA_HOME}/huma/apps/server/scripts"
DO_RESTORE=false
[ "${1:-}" = "--restore" ] && DO_RESTORE=true

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo 로 실행하세요."
  exit 1
fi

echo "=== 1) phone-crank-slots.conf ==="
bash "${DEPLOY}/setup-phone-crank-conf.sh"

echo ""
echo "=== 2) sudoers (ADB·비행기모드·restore) ==="
bash "${DEPLOY}/setup-huma-modem-sudoers.sh"

echo ""
echo "=== 3) ADB 기기 ==="
adb devices -l || true

if [ "$DO_RESTORE" = true ]; then
  echo ""
  echo "=== 4) 네트워크 복구 (포스팅 1~5 + 실폰 6~7) ==="
  bash "${SCRIPTS}/restore-dongle-by-subnet.sh"
else
  echo ""
  echo "=== 4) 복구 스킵 — 실폰 연결 후:"
  echo "  sudo bash ${SCRIPTS}/restore-dongle-by-subnet.sh"
  echo "  또는 HUMA UI 「동글 네트워크 복구」"
fi

echo ""
echo "✓ bootstrap 완료 — pm2 restart huma-server (일반 사용자)"
