# CloudGate state (today)

## Works
- API starts via tools/run-api.sh
- tools/api-up.sh + tools/api-down.sh used for stable start/stop
- /health OK
- /v1/devices create/get OK
- /v1/devices/:id/provision returns node + peer + allowedIp
- /v1/devices/:id/revoke works
- WG_SERVER_PUBLIC_KEY set to real key from wg0

## Pending
- routes/devices.ts: integrate wgAddPeer/wgRemovePeer real calls (ssh to node)
- patch_devices_call_wg.py failed because devices.ts structure differs (no "return { node, peer }" block)
- devices_head.txt + devices_tail.txt saved in .logs for patching tomorrow

## Next step tomorrow
- Use .logs/devices_head.txt + .logs/devices_tail.txt to insert:
  - import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";
  - call wgAddPeer() after peer creation/reuse in provision
  - call wgRemovePeer() in revoke flow
