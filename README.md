# CloudGate MVP

Monorepo: API (Fastify) + Web (Next.js) + Postgres + WireGuard node scripts.

## Devices API identifiers

`POST /v1/devices` returns two identifiers:

- `id`: internal DB primary key (cuid). Use for `GET /v1/devices/:id`, `POST /v1/devices/:id/provision`, `POST /v1/devices/:id/revoke`.
- `deviceId`: external device UUID. Use for `GET /v1/devices/by-device-id/:deviceId`.
