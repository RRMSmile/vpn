#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== dev-api: kill port 3001 (best effort) =="
fuser -k 3001/tcp 2>/dev/null || true

echo "== dev-api: prisma generate =="
pnpm -C apps/api exec -- prisma generate

echo "== dev-api: migrate (fallback db push) =="
pnpm -C apps/api exec -- prisma migrate dev --name dev 2>/dev/null || pnpm -C apps/api exec -- prisma db push

echo "== dev-api: start =="
pnpm -C apps/api dev
