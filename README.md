# CloudGate MVP

Monorepo: API (Fastify) + Web (Next.js) + Postgres + WireGuard node scripts.

## Devices API identifiers

`POST /v1/devices` returns two identifiers:

- `id`: internal DB primary key (cuid). Use for `GET /v1/devices/:id`, `POST /v1/devices/:id/provision`, `POST /v1/devices/:id/revoke`.
- `deviceId`: external device UUID. Use for `GET /v1/devices/by-device-id/:deviceId`.

## Local CI workflow

Use this sequence for smoke validation in local Linux/macOS shells or GitHub-hosted runners:

```bash
docker compose up -d db api
docker compose exec -T api pnpm --filter @cloudgate/api db:deploy
docker compose exec -T api pnpm --filter @cloudgate/api db:seed
node tools/smoke-devices.mjs
pwsh -ExecutionPolicy Bypass -File tools/smoke-devices.ps1
```

## Pre-merge checklist

- [ ] `docker compose up -d db api`
- [ ] `docker compose exec -T api pnpm --filter @cloudgate/api db:deploy`
- [ ] `docker compose exec -T api pnpm --filter @cloudgate/api db:seed`
- [ ] `node tools/smoke-devices.mjs` returns `PASS`
- [ ] `pwsh -ExecutionPolicy Bypass -File tools/smoke-devices.ps1` returns `PASS`
- [ ] API returns expected values for `/health`, `/v1/plans`, and failed-provision invariants
