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

## 4) Provision failure smoke (no active peer / no IP drift)

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\tools\smoke-devices.ps1
```

Expected result:

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

## Notes

- Token mode is one-time: token is marked `usedAt` only after successful provision.
- On provision failure (`502`), token is not consumed and peer invariants remain safe.
