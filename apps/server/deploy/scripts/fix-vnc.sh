#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "== huma VNC fix =="

git fetch origin
git checkout origin/main -- \
  apps/server/deploy/ecosystem.config.cjs \
  apps/server/deploy/scripts/run-x11vnc.sh \
  apps/server/deploy/scripts/fix-vnc.sh \
  apps/server/deploy/scripts/start-x11vnc.sh 2>/dev/null || true
git pull --ff-only

chmod +x apps/server/deploy/scripts/run-x11vnc.sh

pm2 stop huma-x11vnc 2>/dev/null || true
pkill -9 x11vnc 2>/dev/null || true
sleep 2

pm2 delete huma-x11vnc 2>/dev/null || true
pm2 start apps/server/deploy/ecosystem.config.cjs --only huma-x11vnc --update-env

echo "RFB 확인 (최대 15초)..."
for i in $(seq 1 15); do
  if out=$(timeout 2 bash -c 'exec 3<>/dev/tcp/127.0.0.1/5900; head -c 12 <&3' 2>/dev/null) && [[ "$out" == RFB* ]]; then
    echo "RFB banner: $out"
    echo "OK — RealVNC: 172.30.1.96:5900 (Direct, 암호 없음)"
    pm2 ls | grep x11vnc || true
    ss -tlnp | grep 5900 || true
    exit 0
  fi
  sleep 1
done

echo "RFB banner: (없음)"
ss -tlnp | grep 5900 || echo "5900 not listening"
pm2 logs huma-x11vnc --lines 20 --nostream
exit 1
