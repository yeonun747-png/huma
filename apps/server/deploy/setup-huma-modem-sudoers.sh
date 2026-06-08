#!/bin/bash
# PM2 huma-server — 동글 IP 교체·policy routing (비대화형 sudo)
# Usage: sudo HUMA_USER=songchunho bash setup-huma-modem-sudoers.sh

set -euo pipefail

HUMA_USER="${HUMA_USER:-songchunho}"
HUMA_HOME="${HUMA_HOME:-/home/${HUMA_USER}}"
LTE_RESET_SCRIPT="${HUMA_HOME}/huma/apps/server/scripts/huma-modem-lte-reset.sh"
DEST="/etc/sudoers.d/huma-modem"
TMP="$(mktemp)"

cat >"$TMP" <<EOF
# HUMA C-Rank / 포스팅 — 모뎀 ip link·policy routing·LTE 비행기모드 (PM2 비대화형)
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/sbin/ip, /sbin/ip
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/bin/bash ${LTE_RESET_SCRIPT} *
EOF

visudo -cf "$TMP"
install -m 0440 "$TMP" "$DEST"
rm -f "$TMP"

echo "✓ ${DEST}"
echo "검증: sudo -u ${HUMA_USER} sudo -n ip link show"
