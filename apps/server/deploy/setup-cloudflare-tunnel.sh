#!/usr/bin/env bash
# Cloudflare Tunnel 설치·등록 (Ubuntu i7 Worker)
# Usage: sudo bash setup-cloudflare-tunnel.sh api.huma.yourdomain.com
set -euo pipefail

HOSTNAME="${1:-}"
TUNNEL_NAME="${HUMA_TUNNEL_NAME:-huma-studio}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_SRC="${SCRIPT_DIR}/cloudflare-tunnel.yml"

if [[ -z "${HOSTNAME}" ]]; then
  echo "Usage: sudo bash setup-cloudflare-tunnel.sh api.huma.yourdomain.com"
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared..."
  curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb" -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
fi

mkdir -p /etc/cloudflared

if [[ ! -f "/etc/cloudflared/${TUNNEL_NAME}.json" ]]; then
  echo ""
  echo "=== Tunnel credentials not found ==="
  echo "Run once as your user (browser login):"
  echo "  cloudflared tunnel login"
  echo "  cloudflared tunnel create ${TUNNEL_NAME}"
  echo "Then copy credentials:"
  echo "  sudo cp ~/.cloudflared/${TUNNEL_ID}.json /etc/cloudflared/${TUNNEL_NAME}.json"
  echo ""
  exit 1
fi

sed "s/api.huma.yourdomain.com/${HOSTNAME}/g" "${CONFIG_SRC}" > /etc/cloudflared/config.yml
echo "Wrote /etc/cloudflared/config.yml (hostname: ${HOSTNAME})"

cloudflared tunnel route dns "${TUNNEL_NAME}" "${HOSTNAME}" || true

cp "${SCRIPT_DIR}/cloudflared-tunnel.service" /etc/systemd/system/cloudflared-huma.service
systemctl daemon-reload
systemctl enable cloudflared-huma.service
systemctl restart cloudflared-huma.service

echo ""
echo "Tunnel started. Test:"
echo "  curl -s https://${HOSTNAME}/api/health"
echo ""
echo "Vercel env:"
echo "  NEXT_PUBLIC_HUMA_API_URL=https://${HOSTNAME}"
