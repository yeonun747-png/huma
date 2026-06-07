#!/usr/bin/env bash
# Tailscale — 집 밖에서 RealVNC (i7 Ubuntu)
# Usage: bash setup-tailscale.sh
# Personal plan 무료 · i7 + PC 같은 tailnet
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SERVER_ROOT}/.env"
VNC_PORT="${HUMA_VNC_PORT:-5900}"

echo "== Tailscale (huma VNC 원격) =="

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

sudo systemctl enable --now tailscaled 2>/dev/null || true

if ! tailscale status >/dev/null 2>&1; then
  echo ""
  echo "Tailscale 로그인 (아래 URL을 브라우저에서 열기):"
  sudo tailscale up
fi

TS_IP="$(tailscale ip -4 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
if [[ -z "${TS_IP}" ]]; then
  echo "Tailscale IPv4 없음 — tailscale status 확인"
  tailscale status 2>/dev/null || true
  exit 1
fi

VNC_URL="vnc://${TS_IP}:${VNC_PORT}"

echo ""
echo "Tailscale IPv4: ${TS_IP}"
echo "RealVNC Direct: ${TS_IP}:${VNC_PORT}"
echo ""
echo "=== apps/server/.env ==="
echo "HUMA_VNC_URL_YEONUN=${VNC_URL}"
echo "HUMA_VNC_URL_QUIZ_PANANA=${VNC_URL}   # 퀴즈/파나나 동일 i7이면"
echo ""

if [[ -f "${ENV_FILE}" ]]; then
  if grep -q '^HUMA_VNC_URL_YEONUN=' "${ENV_FILE}"; then
    sed -i "s|^HUMA_VNC_URL_YEONUN=.*|HUMA_VNC_URL_YEONUN=${VNC_URL}|" "${ENV_FILE}"
    echo "Updated HUMA_VNC_URL_YEONUN in ${ENV_FILE}"
  else
    printf '\n# Tailscale VNC (집 밖 RealVNC Direct)\nHUMA_VNC_URL_YEONUN=%s\n' "${VNC_URL}" >> "${ENV_FILE}"
    echo "Appended HUMA_VNC_URL_YEONUN to ${ENV_FILE}"
  fi
else
  echo "(.env 없음 — 위 줄을 apps/server/.env 에 직접 추가)"
fi

echo ""
echo "Windows PC:"
echo "  1) https://tailscale.com/download/windows 설치"
echo "  2) i7과 같은 계정으로 로그인"
echo "  3) RealVNC Viewer → Direct → ${TS_IP}:${VNC_PORT}"
echo ""
echo "  pm2 restart huma-server --update-env"
