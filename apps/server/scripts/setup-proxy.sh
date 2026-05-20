#!/bin/bash
# 3proxy setup for HUMA Studio LTE dongles (기획서 7-13)
# Usage: sudo bash setup-proxy.sh

set -e

CONFIG="/etc/3proxy/3proxy.cfg"
cat > "$CONFIG" << 'EOF'
auth none
allow *
EOF

for i in $(seq 1 10); do
  PORT=$((10000 + i))
  IFACE="wwan$((i-1))"
  IP=$(ip -4 addr show "$IFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1 || echo "")
  if [ -n "$IP" ]; then
    echo "proxy -p${PORT} -i127.0.0.1 -e${IP}" >> "$CONFIG"
    echo "Slot $i: port $PORT -> $IFACE ($IP)"
  else
    echo "proxy -p${PORT} -i127.0.0.1" >> "$CONFIG"
    echo "Slot $i: port $PORT (interface $IFACE not found, no external IP)"
  fi
done

systemctl restart 3proxy || service 3proxy restart
echo "3proxy configured. Ports 10001-10010"
