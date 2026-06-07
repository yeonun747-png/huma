#!/usr/bin/env bash
# VNC 복구: systemd x11vnc 재기동 + RFB 확인
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
DEPLOY="${ROOT}/apps/server/deploy"
cd "$ROOT"

echo "== huma VNC fix (systemd) =="

git fetch origin 2>/dev/null || true
git checkout origin/main -- \
  apps/server/deploy/ecosystem.config.cjs \
  apps/server/deploy/scripts/run-x11vnc.sh \
  apps/server/deploy/scripts/check-vnc-rfb.sh \
  apps/server/deploy/scripts/fix-vnc.sh \
  apps/server/deploy/huma-x11vnc.service \
  apps/server/deploy/setup-x11vnc-systemd.sh 2>/dev/null || true
git pull --ff-only 2>/dev/null || true

chmod +x "${DEPLOY}/scripts/run-x11vnc.sh" "${DEPLOY}/scripts/check-vnc-rfb.sh"

# pm2 x11vnc 제거 (systemd 전용)
pm2 delete huma-x11vnc 2>/dev/null || true
pm2 save 2>/dev/null || true

pkill -9 x11vnc 2>/dev/null || true
sleep 2

if systemctl is-enabled huma-x11vnc.service >/dev/null 2>&1; then
  sudo systemctl restart huma-x11vnc.service
else
  echo "systemd 미등록 — 최초 1회:"
  echo "  sudo HUMA_USER=\$USER bash ${DEPLOY}/setup-x11vnc-systemd.sh"
  echo "수동 기동 (임시):"
  nohup bash "${DEPLOY}/scripts/run-x11vnc.sh" >>/tmp/huma-x11vnc.log 2>&1 &
  sleep 4
fi

if bash "${DEPLOY}/scripts/check-vnc-rfb.sh"; then
  echo "OK — RealVNC: 172.30.1.96:5900 (Direct, 암호 없음)"
  exit 0
fi

exit 1
