#!/usr/bin/env bash
# Xvfb :99 — VNC 수동 입력용 fcitx-hangul (Playwright 자동화와 별도)
set -euo pipefail
DISPLAY="${HUMA_DISPLAY:-:99}"
export DISPLAY

if ! command -v fcitx >/dev/null 2>&1; then
  exit 0
fi

if pgrep -f "fcitx.*${DISPLAY}" >/dev/null 2>&1 || pgrep -x fcitx >/dev/null 2>&1; then
  fcitx-remote -s hangul 2>/dev/null || true
  exit 0
fi

fcitx -d 2>/dev/null || true
sleep 0.5
fcitx-remote -s hangul 2>/dev/null || true
