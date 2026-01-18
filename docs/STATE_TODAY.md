# CloudGate state (today)

## Works
- API starts via tools/run-api.sh
- Stable start/stop: tools/api-up.sh + tools/api-down.sh
- /health OK
- /v1/devices create/get OK
- /v1/devices/:id/provision creates or unrevoke peer in DB
- provision applies peer on WG node via ssh (wgAddPeer) -> verified YES_ON_NODE
- /v1/devices/:id/revoke removes peer on WG node (wgRemovePeer) then marks revokedAt
- WG_SERVER_PUBLIC_KEY set to real key from wg0

## Key commit
- 734aee2 feat(api): wire wgAddPeer/wgRemovePeer into devices provision/revoke

## How to run tomorrow
- ./tools/api-up.sh
- ./tools/test-devices.sh tg:999
- ssh yc-user@89.169.176.214 "sudo wg show wg0 | head -n 60"

## Pending next
- Make provision idempotent on node too (avoid wg error if peer already present)
- Add simple debug endpoint or tool to check node state (optional)
- Wire Telegram bot flow to these endpoints (device register + provision + revoke)
