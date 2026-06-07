#!/usr/bin/env bash
# i7 — fcitx-hangul OS IME (Playwright 한글 입력 B 옵션)
# 사용: sudo bash apps/server/scripts/setup-os-ime.sh

set -euo pipefail

if [[ "$(uname)" != "Linux" ]]; then
  echo "Linux(i7) 전용입니다."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y fcitx fcitx-hangul fcitx-config-gtk dbus-x11

IM_CONFIG='/etc/X11/xinit/xinputrc'
if [[ -f "$IM_CONFIG" ]]; then
  echo 'export GTK_IM_MODULE=fcitx' > "$IM_CONFIG"
  echo 'export QT_IM_MODULE=fcitx' >> "$IM_CONFIG"
  echo 'export XMODIFIERS=@im=fcitx' >> "$IM_CONFIG"
fi

echo ""
echo "✓ fcitx-hangul 설치 완료"
echo "  pm2 worker 재시작 전 DISPLAY=:99 Xvfb 세션에서 fcitx -d 실행 권장"
echo "  human_engine.use_os_ime=true (기본) · HUMA_USE_OS_IME=false 로 합성 IME 폴백"
