#!/usr/bin/env bash
set -euo pipefail

FILE="apps/api/src/index.ts"
if [[ ! -f "$FILE" ]]; then
  echo "ERROR: $FILE not found"
  exit 1
fi

python3 - <<'PY'
import re, pathlib

path = pathlib.Path("apps/api/src/index.ts")
s = path.read_text()

def add_import(line: str):
  global s
  if line in s:
    return
  imports = list(re.finditer(r'^(import .*?;\s*)$', s, flags=re.M))
  if imports:
    i = imports[-1].end()
    s = s[:i] + "\n" + line + "\n" + s[i:]
  else:
    s = line + "\n" + s

# Add imports (idempotent)
add_import('import formbody from "@fastify/formbody";')
add_import('import { plansRoutes } from "./routes/plans";')
add_import('import { subscriptionsRoutes } from "./routes/subscriptions";')
add_import('import { paymentsRobokassaRoutes } from "./routes/payments.robokassa";')

# Insert register block before "await app.listen"
if "app.register(plansRoutes" not in s and "await app.register(plansRoutes" not in s:
  block = (
    "  await app.register(formbody);\n"
    "  await app.register(plansRoutes);\n"
    "  await app.register(subscriptionsRoutes);\n"
    "  await app.register(paymentsRobokassaRoutes);\n\n"
  )

  # Find insertion point before first await app.listen(
  m = re.search(r'\n(\s*)await\s+app\.listen\s*\(', s)
  if not m:
    raise SystemExit("Cannot find 'await app.listen(' in index.ts")

  s = s[:m.start()+1] + block + s[m.start()+1:]

path.write_text(s)
print("patched:", path)
PY

echo "OK"
