#!/bin/bash
# 동글 네트워크 일괄 설정: policy routing + 3proxy SOCKS5
# Usage: sudo bash setup-dongle-network.sh [eth0:10001 ...]

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SLOTS=("$@")

if [ "$#" -eq 0 ]; then
  bash "$DIR/huma-dongle-routes.sh"
  bash "$DIR/setup-proxy-socks.sh"
else
  bash "$DIR/huma-dongle-routes.sh" "$@"
  bash "$DIR/setup-proxy-socks.sh" "$@"
fi

echo ""
bash "$DIR/check-socks-proxy.sh" 10001 10002 10003 10004 10005 10006 10007
