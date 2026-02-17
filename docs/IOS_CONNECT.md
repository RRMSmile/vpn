# iOS Connect Token API

This document describes the token-driven API contract for iOS onboarding.

## Token rules

- Token model: `ConnectToken { token, userId, deviceId, expiresAt, usedAt, createdAt }`.
- TTL is enforced by `expiresAt`.
- Tokens are one-time:
  - `usedAt` is set only after successful `POST /v1/connect/:token/provision`.
  - If provision fails (for example `502 WG_ADD_FAILED`), token is not consumed.

## Endpoints

### POST /v1/connect/:token/provision

Request body:

```json
{
  "publicKey": "<wireguard-public-key>"
}
```

Behavior:

- Validates token exists, not expired, not used.
- Maps token to device by `(userId, deviceId)`; creates device if missing.
- Calls canonical devices provision flow.
- Returns VPN data for client config.

Success response (`200` for existing peer, `201` for new peer):

```json
{
  "peerId": "...",
  "allowedIp": "10.8.0.2",
  "dns": "1.1.1.1",
  "serverPublicKey": "...",
  "endpointHost": "...",
  "endpointPort": 51820,
  "persistentKeepalive": 25,
  "config": "[Interface]...",
  "existing": false
}
```

Error response examples:

- `404 { "error": "connect_token_not_found" }`
- `409 { "error": "connect_token_used" }`
- `410 { "error": "connect_token_expired" }`
- `502 { "error": "WG_ADD_FAILED" }`

### GET /v1/connect/:token/status

Returns token status and whether an active peer exists for token device.

Example response:

```json
{
  "token": {
    "value": "...",
    "status": "ready",
    "expiresAt": "2026-02-17T20:00:00.000Z",
    "usedAt": null,
    "createdAt": "2026-02-17T19:00:00.000Z",
    "userId": "tg:999",
    "deviceId": "11111111-2222-3333-4444-555555555555"
  },
  "hasActivePeer": false,
  "activePeer": null
}
```

`status` values: `ready`, `used`, `expired`.

### POST /v1/connect/:token/revoke

Revokes active peer for token-mapped device via canonical devices revoke flow.

Response example:

```json
{
  "revoked": true,
  "peerId": "...",
  "deviceId": "...",
  "nodeId": "wg-node-1"
}
```

## Dev token generation

Run inside API container:

```bash
docker compose exec -T api pnpm --filter @cloudgate/api tsx tools/gen-connect-token.ts --userId tg:999 --deviceId 11111111-2222-3333-4444-555555555555 --ttl 3600
```

Output includes:

- `token=<token>`
- `deepLink=safevpn://connect/<token>`
- `provisionPath=/v1/connect/<token>/provision`

## cURL examples

Provision:

```bash
curl -sS -X POST http://localhost:3001/v1/connect/<token>/provision \
  -H 'content-type: application/json' \
  -d '{"publicKey":"<wireguard-public-key>"}'
```

Status:

```bash
curl -sS http://localhost:3001/v1/connect/<token>/status
```

Revoke:

```bash
curl -sS -X POST http://localhost:3001/v1/connect/<token>/revoke
```
