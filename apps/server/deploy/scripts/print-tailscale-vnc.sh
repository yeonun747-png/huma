#!/usr/bin/env bash
# Tailscale IP + huma VNC env 한 줄 출력
set -euo pipefail

PORT="${HUMA_VNC_PORT:-5900}"
TS_IP="$(tailscale ip -4 2>/dev/null | head -1 | tr -d '[:space:]' || true)"

if [[ -z "${TS_IP}" ]]; then
  echo "Tailscale 미연결 — bash apps/server/deploy/setup-tailscale.sh" >&2
  exit 1
fi

echo "Tailscale: ${TS_IP}:${PORT}"
echo "HUMA_VNC_URL_YEONUN=vnc://${TS_IP}:${PORT}"
