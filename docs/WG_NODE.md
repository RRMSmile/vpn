# WG Node Runbook

## Goal

Document the minimum requirements for a WireGuard node used by CloudGate backend (`wgAddPeer` / `wgRemovePeer`) without changing runtime behavior.

## Host requirements

- Linux host with WireGuard tools installed (`wg`, `wg-quick` or equivalent package).
- Active interface expected by backend (`WG_INTERFACE`, usually `wg0`).
- SSH access for backend service account (`WG_NODE_SSH_USER@WG_NODE_SSH_HOST`).
- Non-interactive sudo support for WireGuard commands (`sudo -n ...`), otherwise API calls will fail with `WG_ADD_FAILED` / `WG_REMOVE_FAILED`.

## Secrets and compose wiring

- Keep SSH private key outside git (for example in `./.secrets/wg_node_key`).
- Mount key as read-only secret into API container:
  - volume: `${HOST_KEY}:/run/secrets/wg_node_key:ro`
  - env: `WG_NODE_KEY_PATH=/run/secrets/wg_node_key`
- Keep known hosts in a tracked-safe path (for example `./.ssh/known_hosts`) and mount read-only.
- Never store real private keys, passwords, or tokens in tracked files.

## Minimal verification commands

Run from backend host/container context with the same key/user values as production:

```bash
ssh <user>@<host> "echo ok"
ssh <user>@<host> "sudo -n wg show wg0"
```

Expected:
- `echo ok` confirms SSH reachability and key auth.
- `sudo -n wg show wg0` prints interface/peers without prompting for password.

## Sudoers notes (important)

- `sudoers` wildcards and argument restrictions are possible, but careless rules can grant broader privileges than intended.
- Treat wildcard examples as illustrative only.
- Preferred approach: allow a tightly scoped wrapper script (fixed command set, validated arguments, explicit logging) and grant sudo only for that script.
- Re-validate sudoers after every change; test with `sudo -n` to ensure no interactive prompt paths remain.
