#!/usr/bin/env bash
# x11vnc → systemd 등록 (재부팅 자동 기동). pm2 huma-x11vnc 는 제거.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HUMA_USER="${HUMA_USER:-$(whoami)}"
HUMA_HOME="${HUMA_HOME:-$(eval echo "~${HUMA_USER}")}"

if [[ $EUID -ne 0 ]]; then
  echo "sudo 로 실행: sudo HUMA_USER=${HUMA_USER} bash setup-x11vnc-systemd.sh"
  exit 1
fi

chmod +x "${SCRIPT_DIR}/scripts/run-x11vnc.sh"

sed \
  -e "s|@HUMA_USER@|${HUMA_USER}|g" \
  -e "s|@HUMA_HOME@|${HUMA_HOME}|g" \
  "${SCRIPT_DIR}/huma-x11vnc.service" > /etc/systemd/system/huma-x11vnc.service

systemctl daemon-reload
systemctl enable huma-x11vnc.service

# pm2 에서 x11vnc 제거 (systemd 가 담당)
sudo -u "${HUMA_USER}" pm2 delete huma-x11vnc 2>/dev/null || true
sudo -u "${HUMA_USER}" pm2 save 2>/dev/null || true

pkill -9 x11vnc 2>/dev/null || true
sleep 2
systemctl restart huma-x11vnc.service

echo ""
echo "== huma-x11vnc systemd =="
systemctl status huma-x11vnc.service --no-pager || true
echo ""
echo "RFB 확인:"
sudo -u "${HUMA_USER}" bash "${SCRIPT_DIR}/scripts/check-vnc-rfb.sh" || true
