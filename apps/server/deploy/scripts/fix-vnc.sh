#!/usr/bin/env bash
# i7 VNC(x11vnc) 복구 — git 로컬 수정 덮어쓰기 + pm2 재등록
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "== huma VNC fix =="

git checkout -- apps/server/deploy/scripts/start-x11vnc.sh 2>/dev/null || true
git pull

if ! grep -q 'exec x11vnc' apps/server/deploy/scripts/start-x11vnc.sh; then
  echo "ERROR: start-x11vnc.sh 가 최신이 아닙니다 (exec x11vnc 없음)" >&2
  exit 1
fi

chmod +x apps/server/deploy/scripts/start-x11vnc.sh

pm2 stop huma-x11vnc 2>/dev/null || true
pkill -9 x11vnc 2>/dev/null || true
sleep 2

if ss -tlnp 2>/dev/null | grep -q ':5900 '; then
  echo "WARN: 5900 still in use"
  ss -tlnp | grep 5900 || true
fi

pm2 delete huma-x11vnc 2>/dev/null || true
pm2 start apps/server/deploy/ecosystem.config.cjs --only huma-x11vnc --update-env

sleep 4

echo -n "RFB banner: "
if timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/5900; head -c 12 <&3'; then
  echo ""
  echo "OK — RealVNC: 172.30.1.96:5900 (Direct, 암호 없음)"
  pm2 ls | grep x11vnc || true
else
  echo "(없음)"
  echo "수동 기동 시도..."
  pm2 stop huma-x11vnc 2>/dev/null || true
  pkill -9 x11vnc 2>/dev/null || true
  sleep 1
  DISPLAY=:99 x11vnc -display :99 -forever -shared -nopw -no6 -listen 0.0.0.0 -rfbport 5900 &
  sleep 3
  timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/5900; head -c 12 <&3' || true
  echo "수동 기동 후 RealVNC 테스트. pm2 logs huma-x11vnc --lines 20"
fi
