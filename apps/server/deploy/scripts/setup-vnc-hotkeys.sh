#!/usr/bin/env bash
# i7 Xvfb — Ctrl+Alt+1~5 포커스 · Ctrl+Alt+0 분할 (Chromium F1 도움말 충돌 회피)
set -euo pipefail

PORT="${PORT:-3100}"
BASE="http://127.0.0.1:${PORT}/api/vnc"
RC="${HOME}/.huma-vnc-xbindkeysrc"

if ! command -v xbindkeys >/dev/null 2>&1; then
  echo "xbindkeys 미설치: sudo apt install xbindkeys" >&2
  exit 1
fi

cat > "${RC}" <<EOF
# HUMA VNC — DISPLAY=:99 (RealVNC 접속 시 i7에서 실행)
"curl -fsS -X POST ${BASE}/focus/1"  control+mod1 + 1
"curl -fsS -X POST ${BASE}/focus/2"  control+mod1 + 2
"curl -fsS -X POST ${BASE}/focus/3"  control+mod1 + 3
"curl -fsS -X POST ${BASE}/focus/4"  control+mod1 + 4
"curl -fsS -X POST ${BASE}/focus/5"  control+mod1 + 5
"curl -fsS -X POST ${BASE}/layout/tile"  control+mod1 + 0
"DISPLAY=:99 fcitx-remote -t 2>/dev/null || true"  control + space
"DISPLAY=:99 fcitx-remote -t 2>/dev/null || true"  Alt_R
"DISPLAY=:99 fcitx-remote -t 2>/dev/null || true"  Hangul
EOF

echo "Wrote ${RC}"
echo "Run: DISPLAY=:99 xbindkeys -f ${RC}"
echo "Persist: echo 'DISPLAY=:99 xbindkeys -f ${RC}' >> ~/.profile"
