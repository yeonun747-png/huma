#!/usr/bin/env bash
# Tailscale + VNC 5900 진단 (i7)
set -euo pipefail

PORT="${HUMA_VNC_PORT:-5900}"
TS_IP="$(tailscale ip -4 2>/dev/null | head -1 | tr -d '[:space:]' || true)"

echo "== huma Tailscale VNC check =="
echo ""

echo "-- tailscale status --"
tailscale status 2>/dev/null || { echo "Tailscale 미연결"; exit 1; }
echo ""

if [[ -z "${TS_IP}" ]]; then
  echo "FAIL: Tailscale IPv4 없음"
  exit 1
fi
echo "Tailscale IP: ${TS_IP}"
echo ""

echo "-- x11vnc / 5900 --"
ss -tlnp 2>/dev/null | grep ":${PORT} " || echo "WARN: ${PORT} not listening"
pgrep -af x11vnc || echo "WARN: x11vnc process not found"
echo ""

echo "-- local RFB (127.0.0.1) --"
python3 - <<'PY' || echo "FAIL: local RFB"
import socket
s = socket.create_connection(("127.0.0.1", 5900), 3)
print(s.recv(12))
s.close()
PY
echo ""

echo "-- Tailscale IP RFB (${TS_IP}) --"
python3 - <<PY || echo "FAIL: Tailscale IP RFB — ufw allow in on tailscale0 to any port ${PORT}"
import socket
s = socket.create_connection(("${TS_IP}", ${PORT}), 3)
print(s.recv(12))
s.close()
PY
echo ""

if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -qi active; then
  echo "-- ufw (active) — tailscale0 5900 허용 권장 --"
  sudo ufw status | grep -E '5900|tailscale' || echo "  (규칙 없음 → sudo ufw allow in on tailscale0 to any port ${PORT} proto tcp)"
  echo ""
fi

echo "Windows PC:"
echo "  1) Tailscale 설치 + i7과 같은 계정 (Admin Machines 2대 Connected)"
echo "  2) Test-NetConnection ${TS_IP} -Port ${PORT}"
echo "  3) RealVNC Direct → ${TS_IP}:${PORT}"
echo ""
echo "LAN만: 172.30.1.96:${PORT} (같은 Wi‑Fi)"
