# iOS Connect Link Contract v1

## Overview
One-time token based provisioning for iOS.
iOS generates WireGuard keypair locally and sends **publicKey** to API.
API returns **clientConfig without PrivateKey**.

## Endpoints

### 1) Create connect link
POST /v1/connect-links

```bash
curl -sS -X POST http://localhost:3001/v1/connect-links \\
  -H "content-type: application/json" \\
  -d "{\\\"ttlMinutes\\\": 60}"
```

Response:
```json
{\n  \"token\": \"hex...\",\n  \"expiresAt\": \"ISO8601\",\n  \"deepLink\": \"safevpn://connect/hex...\"\n}\n```

### 2) Provision via connect link
POST /v1/connect/:token/provision

```bash
curl -sS -X POST http://localhost:3001/v1/connect/<token>/provision \\
  -H "content-type: application/json" \\
  -d "{\\\"publicKey\\\":\\\"<WG_PUBLIC_KEY>\\\",\\\"platform\\\":\\\"IOS\\\",\\\"deviceName\\\":\\\"iPhone\\\"}"
```

Errors:
- 404 INVALID_TOKEN
- 410 TOKEN_EXPIRED
- 409 TOKEN_ALREADY_BOUND
