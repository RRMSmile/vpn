#!/usr/bin/env bash
set -euo pipefail

f="apps/bot/src/index.ts"

# Ловим именно "вставки из терминала", а не легитимные строки логирования в коде.
# Эти паттерны практически не встречаются в TS-файле по делу.
rg -n -S \
  -e '^\s*dev@\w+:[^$]*\$\s' \
  -e '^\s*PS\s+[A-Z]:\\' \
  -e '^\s*(bot|api|web)-\d+\s*\|\s' \
  -e '^\s*cloudgate-[^\s]+\s*\|\s' \
  -e '^\s*>\s*@cloudgate/' \
  -e '^\s*Done in \d' \
  -e '^\s*Progress: resolved' \
  -e '^\s*\[\+\]\s+Running' \
  -e '^\s*error:\s+corrupt patch' \
  "$f" && {
    echo "ERROR: bot source looks corrupted by terminal output: $f" >&2
    exit 2
  }

echo "OK: $f looks clean"
