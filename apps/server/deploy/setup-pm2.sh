#!/usr/bin/env bash
# HUMA Worker PM2 등록 (Ubuntu i7)
# Usage: bash setup-pm2.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${SERVER_ROOT}"

if [[ ! -f .env ]]; then
  echo "Missing apps/server/.env"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installing PM2..."
  sudo npm install -g pm2
fi

mkdir -p /data/browser-profiles
chmod 755 /data/browser-profiles

echo "Building server..."
npm run build

pm2 delete huma-xvfb huma-x11vnc huma-server 2>/dev/null || true
pm2 start "${SCRIPT_DIR}/ecosystem.config.cjs"
pm2 save

echo ""
echo "VNC (x11vnc) — systemd 등록 (재부팅 자동, pm2 파이프 이슈 회피):"
echo "  sudo HUMA_USER=\$USER bash ${SCRIPT_DIR}/setup-x11vnc-systemd.sh"
echo ""
echo "Enable boot startup (pm2 — Xvfb + server):"
echo "  pm2 startup"
echo "  (printed command를 sudo로 실행)"
echo ""
pm2 status
echo ""
echo "Logs: pm2 logs huma-server"
