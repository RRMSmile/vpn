#!/usr/bin/env bash
set -euo pipefail
apt-get update
apt-get install -y wireguard iptables-persistent

cat >/etc/sysctl.d/99-cloudgate.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
EOF

sysctl --system

mkdir -p /opt/cloudgate/state
chmod 700 /opt/cloudgate /opt/cloudgate/state