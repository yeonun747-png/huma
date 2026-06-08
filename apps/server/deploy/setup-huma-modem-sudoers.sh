#!/bin/bash
# PM2 huma-server — 동글 IP 교체·policy routing (비대화형 sudo)
# Usage: sudo HUMA_USER=songchunho bash setup-huma-modem-sudoers.sh

set -euo pipefail

HUMA_USER="${HUMA_USER:-songchunho}"
DEST="/etc/sudoers.d/huma-modem"
TMP="$(mktemp)"

cat >"$TMP" <<EOF
# HUMA C-Rank / 포스팅 — 모뎀 ip link·policy routing (PM2 비대화형)
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/sbin/ip, /sbin/ip
EOF

visudo -cf "$TMP"
install -m 0440 "$TMP" "$DEST"
rm -f "$TMP"

echo "✓ ${DEST}"
echo "검증: sudo -u ${HUMA_USER} sudo -n ip link show"
