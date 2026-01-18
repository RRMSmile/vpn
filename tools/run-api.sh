#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# best effort: free port
fuser -k 3001/tcp 2>/dev/null || true

echo "== prisma generate =="
pnpm -C apps/api exec -- prisma generate

echo "== db push (non-interactive) =="
pnpm -C apps/api exec -- prisma db push

echo "== start (no watch) =="
pnpm -C apps/api exec -- tsx src/index.ts
