#!/bin/bash
# C-Rank 실폰 ADB serial 설정 복사
# Usage: sudo HUMA_USER=songchunho bash setup-phone-crank-conf.sh

set -euo pipefail

HUMA_USER="${HUMA_USER:-songchunho}"
HUMA_HOME="${HUMA_HOME:-/home/${HUMA_USER}}"
SRC="${HUMA_HOME}/huma/apps/server/scripts/phone-crank-slots.example.conf"
DEST="/etc/huma/phone-crank-slots.conf"

mkdir -p /etc/huma
if [ -f "$DEST" ]; then
  echo "유지: ${DEST} (이미 존재)"
else
  cp "$SRC" "$DEST"
  chmod 644 "$DEST"
  echo "✓ ${DEST} 생성 — adb serial 확인 후 수정"
fi
