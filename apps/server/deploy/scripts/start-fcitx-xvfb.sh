#!/usr/bin/env bash
# Xvfb :99 — VNC 수동 입력용 fcitx-hangul (Playwright 자동화와 별도)
set -euo pipefail
DISPLAY="${HUMA_DISPLAY:-:99}"
export DISPLAY
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
export INPUT_METHOD=fcitx
export LANG=ko_KR.UTF-8
export LC_CTYPE=ko_KR.UTF-8

HUMA_DIR="${HOME}/.huma"
SESSION_ENV="${HUMA_DIR}/fcitx-session.env"
mkdir -p "${HUMA_DIR}"

if ! command -v fcitx >/dev/null 2>&1; then
  exit 0
fi

# dbus — fcitx·Chromium IME 조합에 필요
if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]] && command -v dbus-launch >/dev/null 2>&1; then
  eval "$(dbus-launch --sh-syntax)"
  export DBUS_SESSION_BUS_ADDRESS
fi

{
  echo "# HUMA fcitx session — Chromium VNC 수동 입력용"
  echo "DISPLAY=${DISPLAY}"
  [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]] && echo "DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS}"
} > "${SESSION_ENV}"

# 한/영 키맵 (X 레벨 — VNC에서 한/영키가 안 올 때도 Ctrl+Space 동작)
if command -v setxkbmap >/dev/null 2>&1; then
  DISPLAY="${DISPLAY}" setxkbmap -layout us,kr -option grp:ctrl_space_toggle,grp_led:scroll 2>/dev/null || true
fi

if pgrep -f "fcitx.*${DISPLAY}" >/dev/null 2>&1 || pgrep -x fcitx >/dev/null 2>&1; then
  DISPLAY="${DISPLAY}" fcitx-remote -s hangul 2>/dev/null || true
else
  DISPLAY="${DISPLAY}" fcitx -d 2>/dev/null || true
  sleep 0.8
  DISPLAY="${DISPLAY}" fcitx-remote -s hangul 2>/dev/null || true
fi

# VNC 단축키·한/영 — xbindkeys (RealVNC가 Ctrl+Alt·한/영을 클라이언트에서 먹을 수 있음)
if command -v xbindkeys >/dev/null 2>&1; then
  PORT="${PORT:-3100}"
  BASE="http://127.0.0.1:${PORT}/api/vnc"
  RC="${HOME}/.huma-vnc-xbindkeysrc"
  cat > "${RC}" <<EOF
"curl -fsS -X POST ${BASE}/focus/1"  control+mod1 + 1
"curl -fsS -X POST ${BASE}/focus/2"  control+mod1 + 2
"curl -fsS -X POST ${BASE}/focus/3"  control+mod1 + 3
"curl -fsS -X POST ${BASE}/focus/4"  control+mod1 + 4
"curl -fsS -X POST ${BASE}/focus/5"  control+mod1 + 5
"curl -fsS -X POST ${BASE}/layout/tile"  control+mod1 + 0
"DISPLAY=${DISPLAY} fcitx-remote -t 2>/dev/null || true"  control + space
"DISPLAY=${DISPLAY} fcitx-remote -t 2>/dev/null || true"  Alt_R
"DISPLAY=${DISPLAY} fcitx-remote -t 2>/dev/null || true"  Hangul
EOF
  pkill -x xbindkeys 2>/dev/null || true
  DISPLAY="${DISPLAY}" xbindkeys -f "${RC}" 2>/dev/null &
fi
