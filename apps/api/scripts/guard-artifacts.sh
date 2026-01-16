#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Что считаем "артефактами" от битых вставок
PATTERN='TS\}\)|TS\}\;|TSreturn|EOFrocess|PYint|EVOKED|md,pts|sed -n .* \|PYint|cat > .* <<'\''TS'\''.*TS\}\)'

# Где ищем
TARGETS=(src prisma)

echo "== guard-artifacts: scanning for heredoc/console artifacts =="
if rg -n --hidden --no-ignore -S "$PATTERN" "${TARGETS[@]}" >/dev/null; then
  echo "ERROR: artifacts detected:"
  rg -n --hidden --no-ignore -S "$PATTERN" "${TARGETS[@]}" || true
  exit 2
fi

echo "OK: no artifacts found"
