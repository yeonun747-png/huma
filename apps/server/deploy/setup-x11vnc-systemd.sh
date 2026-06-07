#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HUMA_USER="${HUMA_USER:-$(whoami)}"
HUMA_HOME="${HUMA_HOME:-$(eval echo "~${HUMA_USER}")}"

if [[ $EUID -ne 0 ]]; then
  echo "sudo 로 실행: sudo HUMA_USER=${HUMA_USER} bash setup-x11vnc-systemd.sh"
  exit 1
fi

chmod +x "${SCRIPT_DIR}/scripts/run-x11vnc.sh" "${SCRIPT_DIR}/scripts/check-vnc-rfb.sh"

# git 로컬 수정 덮어쓰기 (i7 수동 편집 방지)
sudo -u "${HUMA_USER}" git -C "${HUMA_HOME}/huma" checkout origin/main -- \
  apps/server/deploy/scripts/run-x11vnc.sh \
  apps/server/deploy/huma-x11vnc.service 2>/dev/null || true

mkdir -p "${HUMA_HOME}/.huma"
chown "${HUMA_USER}:${HUMA_USER}" "${HUMA_HOME}/.huma"
rm -f /tmp/huma-x11vnc.log

# Xvfb 먼저 (pm2)
sudo -u "${HUMA_USER}" pm2 restart huma-xvfb 2>/dev/null || true
sleep 3

sed \
  -e "s|@HUMA_USER@|${HUMA_USER}|g" \
  -e "s|@HUMA_HOME@|${HUMA_HOME}|g" \
  "${SCRIPT_DIR}/huma-x11vnc.service" > /etc/systemd/system/huma-x11vnc.service

systemctl daemon-reload
systemctl enable huma-x11vnc.service

sudo -u "${HUMA_USER}" pm2 delete huma-x11vnc 2>/dev/null || true
sudo -u "${HUMA_USER}" pm2 save 2>/dev/null || true

pkill -9 x11vnc 2>/dev/null || true
sleep 2

if ! systemctl restart huma-x11vnc.service; then
  echo ""
  echo "== systemctl status =="
  systemctl status huma-x11vnc.service --no-pager -l || true
  echo ""
  echo "== journalctl =="
  journalctl -xeu huma-x11vnc.service --no-pager -n 30 || true
  echo ""
  echo "== ~/.huma/x11vnc.log =="
  tail -30 "${HUMA_HOME}/.huma/x11vnc.log" 2>/dev/null || true
  exit 1
fi

sleep 3
echo ""
echo "== huma-x11vnc systemd =="
systemctl status huma-x11vnc.service --no-pager || true
echo ""
sudo -u "${HUMA_USER}" bash "${SCRIPT_DIR}/scripts/check-vnc-rfb.sh"
