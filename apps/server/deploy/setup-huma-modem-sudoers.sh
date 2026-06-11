#!/bin/bash
# PM2 huma-server — 동글·실폰 IP 교체·policy routing (비대화형 sudo)
# Usage: sudo HUMA_USER=songchunho bash setup-huma-modem-sudoers.sh

set -euo pipefail

HUMA_USER="${HUMA_USER:-songchunho}"
HUMA_HOME="${HUMA_HOME:-/home/${HUMA_USER}}"
SCRIPTS="${HUMA_HOME}/huma/apps/server/scripts"
LTE_RESET_SCRIPT="${SCRIPTS}/huma-modem-lte-reset.sh"
PHONE_RESET_SCRIPT="${SCRIPTS}/huma-phone-airplane-reset.sh"
PHONE_TETHER_SCRIPT="${SCRIPTS}/huma-phone-ensure-tether.sh"
PHONE_RESTORE_SCRIPT="${SCRIPTS}/restore-phone-crank.sh"
NETWORK_RESTORE_SCRIPT="${SCRIPTS}/restore-dongle-by-subnet.sh"
ADB_BIN="$(command -v adb 2>/dev/null || echo /usr/bin/adb)"
DEST="/etc/sudoers.d/huma-modem"
TMP="$(mktemp)"

cat >"$TMP" <<EOF
# HUMA C-Rank / 포스팅 — 모뎀 ip link·policy routing·LTE/실폰 비행기모드 (PM2 비대화형)
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/sbin/ip, /sbin/ip
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/bin/bash ${LTE_RESET_SCRIPT} *
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/bin/bash ${PHONE_RESET_SCRIPT} *
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/bin/bash ${PHONE_TETHER_SCRIPT} *
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/bin/bash ${PHONE_RESTORE_SCRIPT} *
${HUMA_USER} ALL=(ALL) NOPASSWD: /usr/bin/bash ${NETWORK_RESTORE_SCRIPT}
${HUMA_USER} ALL=(ALL) NOPASSWD: ${ADB_BIN} *
EOF

visudo -cf "$TMP"
install -m 0440 "$TMP" "$DEST"
rm -f "$TMP"

echo "✓ ${DEST}"
echo "검증: sudo -u ${HUMA_USER} sudo -n ip link show"
