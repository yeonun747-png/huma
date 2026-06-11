#!/usr/bin/env bash
# i7 Xvfb — F1~F5 VNC 포커스 · F10 분할 복귀 (xbindkeys)
set -euo pipefail

PORT="${PORT:-3100}"
BASE="http://127.0.0.1:${PORT}/api/vnc"
RC="${HOME}/.huma-vnc-xbindkeysrc"

if ! command -v xbindkeys >/dev/null 2>&1; then
  echo "xbindkeys 미설치: sudo apt install xbindkeys" >&2
  exit 1
fi

cat > "${RC}" <<EOF
# HUMA VNC — DISPLAY=:99 에서 동작 (SSH 세션 export DISPLAY=:99)
"curl -fsS -X POST ${BASE}/focus/f1"  F1
"curl -fsS -X POST ${BASE}/focus/f2"  F2
"curl -fsS -X POST ${BASE}/focus/f3"  F3
"curl -fsS -X POST ${BASE}/focus/f4"  F4
"curl -fsS -X POST ${BASE}/focus/f5"  F5
"curl -fsS -X POST ${BASE}/layout/tile"  F10
EOF

echo "Wrote ${RC}"
echo "Run: DISPLAY=:99 xbindkeys -f ${RC}"
echo "Persist: add to ~/.profile → DISPLAY=:99 xbindkeys -f ${RC}"
