#!/usr/bin/env bash
# i7 VNC(x11vnc) 복구
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "== huma VNC fix =="

git checkout -- apps/server/deploy/ecosystem.config.cjs apps/server/deploy/scripts/start-x11vnc.sh 2>/dev/null || true
git pull

chmod +x apps/server/deploy/scripts/start-x11vnc.sh 2>/dev/null || true

pm2 stop huma-x11vnc 2>/dev/null || true
pkill -9 x11vnc 2>/dev/null || true
sleep 2

pm2 delete huma-x11vnc 2>/dev/null || true
pm2 start apps/server/deploy/ecosystem.config.cjs --only huma-x11vnc --update-env

sleep 5

echo -n "RFB banner: "
if timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/5900; head -c 12 <&3'; then
  echo ""
  echo "OK — RealVNC: 172.30.1.96:5900 (Direct, 암호 없음, Cloud 로그아웃)"
  pm2 ls | grep x11vnc || true
else
  echo "(없음) — pm2 logs huma-x11vnc --lines 30"
  pm2 logs huma-x11vnc --lines 30 --nostream
fi
