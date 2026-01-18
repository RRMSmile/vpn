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
- routes/devices.ts: integrate real wgAddPeer/wgRemovePeer (ssh to node)
- tools/patch_devices_call_wg.py failed because devices.ts structure differs (no "return { node, peer }" block)
- devices_head.txt + devices_tail.txt saved in .logs for patching

## Next steps
1) Patch devices.ts to call wgAddPeer on provision and wgRemovePeer on revoke
2) Run: ./tools/api-up.sh && ./tools/test-devices.sh tg:999
3) Verify on node: sudo wg show wg0
