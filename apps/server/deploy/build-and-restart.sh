#!/usr/bin/env bash
# i7 배포: pull → install → build → pm2 restart (build 무출력 hang 시 이 스크립트 사용)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

echo "[deploy] repo: $ROOT"
git pull

echo "[deploy] npm install (workspace root)..."
npm install

echo "[deploy] build @huma/server (esbuild — i7 저메모리 대응)..."
npm run build --workspace=@huma/server

echo "[deploy] pm2 restart..."
pm2 restart huma-server huma-vnc-hud --update-env

echo "[deploy] done"
pm2 status huma-server huma-vnc-hud
