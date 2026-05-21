#!/usr/bin/env bash
# HUMA Worker systemd 등록 (Ubuntu i7)
# Usage: sudo bash setup-systemd.sh
set -euo pipefail

HUMA_USER="${HUMA_USER:-huma}"
HUMA_HOME="${HUMA_HOME:-/home/${HUMA_USER}/huma}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash setup-systemd.sh"
  exit 1
fi

if ! id "${HUMA_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${HUMA_USER}"
  echo "Created user: ${HUMA_USER}"
fi

if [[ ! -f "${HUMA_HOME}/apps/server/.env" ]]; then
  echo "Missing ${HUMA_HOME}/apps/server/.env — clone repo and configure .env first."
  exit 1
fi

if [[ ! -f "${HUMA_HOME}/apps/server/dist/index.js" ]]; then
  echo "Building server..."
  sudo -u "${HUMA_USER}" bash -lc "cd ${HUMA_HOME}/apps/server && npm run build"
fi

mkdir -p /data/browser-profiles
chmod 755 /data/browser-profiles

sed "s|/home/huma/huma|${HUMA_HOME}|g; s|User=huma|User=${HUMA_USER}|g; s|Group=huma|Group=${HUMA_USER}|g" \
  "${SCRIPT_DIR}/huma-server.service" > /etc/systemd/system/huma-server.service

cp "${SCRIPT_DIR}/huma-xvfb.service" /etc/systemd/system/huma-xvfb.service

systemctl daemon-reload
systemctl enable huma-xvfb.service huma-server.service
systemctl restart huma-xvfb.service
systemctl restart huma-server.service

echo ""
echo "Status:"
systemctl status huma-xvfb.service --no-pager -l || true
systemctl status huma-server.service --no-pager -l || true
echo ""
echo "Logs: journalctl -u huma-server -f"
