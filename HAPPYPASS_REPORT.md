# HAPPYPASS Report

## 1) Start docker compose

```bash
docker compose up -d db api
```

Health check:

```bash
curl.exe -fsS http://localhost:3001/health
```

## 2) Apply Prisma migrations

```bash
docker compose exec -T api pnpm --filter @cloudgate/api db:deploy
```

## 3) Seed plans (basic/pro)

```bash
docker compose exec -T api pnpm --filter @cloudgate/api db:seed
curl.exe -fsS http://localhost:3001/v1/plans
```

## 4) Smoke checks (PowerShell + Node)

PowerShell smoke (local):

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\tools\smoke-devices.ps1
```

Node smoke (cross-platform, CI-ready):

```bash
node tools/smoke-devices.mjs
```

Node smoke validates:
- `/health` is OK
- `db:seed` works and `/v1/plans` includes `basic` + `pro`
- failed provision retries keep `activePeers=0`
- `allowedIp` does not drift across retries
- connect token failed provision keeps token in `ready` state (`usedAt=null`)

Expected result for both smokes:

- each provision attempt returns `502 WG_ADD_FAILED`
- active peer count for tested device stays `0`
- `allowedIp` does not drift across retries

## 5) iOS connect token flow

### Create/get device

```bash
curl.exe -fsS -X POST http://localhost:3001/v1/devices -H "content-type: application/json" -d "{\"userId\":\"tg:999\",\"platform\":\"IOS\",\"name\":\"iphone-connect\"}"
```

Take `deviceId` from response.

### Generate connect token (inside api container)

```bash
docker compose exec -T api pnpm --filter @cloudgate/api tsx tools/gen-connect-token.ts --userId tg:999 --deviceId <deviceId> --ttl 3600
```

Output includes:

- `token=<token>`
- `deepLink=safevpn://connect/<token>`
- `provisionPath=/v1/connect/<token>/provision`

### Call token provision

```bash
curl.exe -sS -X POST http://localhost:3001/v1/connect/<token>/provision -H "content-type: application/json" -d "{\"publicKey\":\"<wireguard-public-key>\"}"
```

Additional endpoints:

```bash
curl.exe -fsS http://localhost:3001/v1/connect/<token>/status
curl.exe -fsS -X POST http://localhost:3001/v1/connect/<token>/revoke
```

## 6) E2E connect script (real WG host)

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\tools\e2e-connect.ps1
```

Behavior:
- Reads `WG_NODE_SSH_HOST` / `WG_NODE_SSH_USER` from env (`.env`).
- If host/user are missing or placeholder (``, `127.0.0.1`, `localhost`, `0.0.0.0`): prints `SKIP: WG host/user placeholder` and exits `0` (dev mode).
- If host/user are present but SSH is unreachable:
  - default: prints `SKIP: WG SSH precheck failed` and exits `0`
  - `E2E_STRICT=1`: script exits `1`
- If precheck succeeds: runs full flow:
  - create device
  - generate connect token
  - generate WireGuard keypair
  - `POST /v1/connect/:token/provision`
  - SSH `sudo -n wg show <WG_INTERFACE>` and verify peer present
  - `POST /v1/connect/:token/revoke`
  - SSH verify peer is absent

Safety:
- Private key is never printed.
- Script logs only non-sensitive fields (for example `publicKey`, `peerId`).

## 7) Local CI workflow

Run locally (or in CI containerized runners) in this order:

```bash
docker compose up -d db api
docker compose exec -T api pnpm --filter @cloudgate/api db:deploy
docker compose exec -T api pnpm --filter @cloudgate/api db:seed
node tools/smoke-devices.mjs
pwsh -ExecutionPolicy Bypass -File tools/smoke-devices.ps1
```

Expected result:
- migrations applied
- plans seeded (`basic`, `pro`)
- both smoke scripts end with `PASS`

## Notes

- Token mode is one-time: token is marked `usedAt` only after successful provision.
- On provision failure (`502`), token is not consumed and peer invariants remain safe.
