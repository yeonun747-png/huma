#!/usr/bin/env bash
# RFB 003.008 배너 확인 (bash /dev/tcp 대신 python3 — 더 안정적)
set -euo pipefail

for i in $(seq 1 20); do
  if out=$(python3 - <<'PY' 2>/dev/null
import socket
s = socket.create_connection(("127.0.0.1", 5900), 3)
print(s.recv(12).decode("ascii", errors="replace"))
PY
  ) && [[ "$out" == RFB* ]]; then
    echo "RFB banner: ${out//$'\n'/}"
    exit 0
  fi
  sleep 1
done

echo "RFB banner: (없음)"
ss -tlnp 2>/dev/null | grep 5900 || echo "5900 not listening"
tail -20 /tmp/huma-x11vnc.log 2>/dev/null || true
exit 1
