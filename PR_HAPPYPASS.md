# HappyPass: deviceId fetch, safe provisioning, seed, iOS connect token

## What / Why

This branch hardens provisioning behavior and makes the iOS first-connect flow possible with a one-time token API.

What is included:
- Device fetch now supports `deviceId`, enabling deterministic lookup for app-side flows.
- WireGuard provisioning is made safe under WG failure: no active peer leak and no allowed IP drift across retries.
- Prisma seed support is added to ensure plans (`basic`, `pro`) exist in dev/CI.
- iOS-oriented connect token API is added: provision/status/revoke + token generator tool.
- Operational runbook for HappyPass workflow is documented.

Why:
- Prevent regressions where failed WG apply could leave stale state.
- Standardize bring-up/testing path for local/dev and CI.
- Unblock iOS P0 integration using tokenized connect flow.

## Commits and DoD mapping

- `950c86f` `fix(devices): support fetch by deviceId`
- `88bd6ba` `fix(provision): no active peer/ip leak on wg failure + add smoke script`
- `2d9c737` `chore(db): add db:seed script`
- `5d9a38d` `feat(connect): token-based iOS provision/status/revoke + docs + tool`
- `8c62c1f` `docs(happypass): add final runbook + ensure prisma generate on api startup`

DoD covered:
- Device lookup by `deviceId` works.
- On WG provision failure, active peers remain `0` and `allowedIp` is stable.
- Seed creates plans and `/v1/plans` returns `basic` + `pro`.
- Connect token flow works end-to-end (`provision`, `status`, `revoke`).
- Runbook and smoke scripts are present.

## How to run

```bash
docker compose up -d db api
docker compose exec -T api pnpm --filter @cloudgate/api db:deploy
docker compose exec -T api pnpm --filter @cloudgate/api db:seed
powershell.exe -ExecutionPolicy Bypass -File .\\tools\\smoke-devices.ps1
curl.exe -fsS http://localhost:3001/health
curl.exe -fsS http://localhost:3001/v1/plans
```

## Risks

### ConnectToken migration / rollout
- Existing clients are unaffected, but new iOS token flow depends on `connectToken` table/logic and TTL semantics.
- Operational risk is mostly around token lifecycle assumptions (single-use on success, retained on failure).
- Recommend CI smoke coverage for token flow and explicit monitoring of 4xx/5xx on `/v1/connect/:token/*` during rollout.