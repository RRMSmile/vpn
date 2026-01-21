# WG Node management (MVP via SSH)

Backend must be able to:
- add peer: wg set wg0 peer <pubkey> allowed-ips <ip>/32
- remove peer: wg set wg0 peer <pubkey> remove
- persist peer mapping in DB (deviceId <-> pubkey <-> allowedIp <-> nodeId)

Env (example):
- WG_NODE_SSH_HOST
- WG_NODE_SSH_USER
- WG_INTERFACE=wg0
