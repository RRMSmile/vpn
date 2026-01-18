from __future__ import annotations
from pathlib import Path
import re

index_p = Path("apps/api/src/index.ts")
src = index_p.read_text(encoding="utf-8")
bak = index_p.with_suffix(index_p.suffix + ".devicesroutes.bak")
bak.write_text(src, encoding="utf-8")

routes_dir = Path("apps/api/src/routes")
candidates = [routes_dir / "devices.ts", routes_dir / "device.ts", routes_dir / "devices/index.ts"]
route_file = next((p for p in candidates if p.exists()), None)
if not route_file:
    raise SystemExit("No routes file found: expected devices.ts/device.ts/devices/index.ts in apps/api/src/routes")

route_src = route_file.read_text(encoding="utf-8")

# Try to find exported register function name
m = re.search(r'export\s+(?:async\s+)?function\s+(register\w*Routes)\s*\(', route_src)
if not m:
    raise SystemExit(f"Cannot find exported function like 'export function register...Routes' in {route_file}")

fn = m.group(1)

# Determine import path from index.ts
rel = route_file.relative_to(Path("apps/api/src"))
import_path = "./" + str(rel).replace("\\", "/").replace(".ts", "")
import_line = f'import {{ {fn} }} from "{import_path}";\n'

if import_line not in src:
    # insert after last import
    lines = src.splitlines(True)
    ins = 0
    for i, line in enumerate(lines):
        if line.startswith("import "):
            ins = i + 1
    lines.insert(ins, import_line)
    src = "".join(lines)

# Decide prefix strategy:
# If route file uses "/v1/" in paths -> register without prefix.
# Else if it uses "/devices" -> register with prefix "/v1".
uses_v1 = bool(re.search(r'["\']/v1/', route_src))
uses_devices_plain = bool(re.search(r'["\']\/devices', route_src))

register_call = None
if uses_v1:
    register_call = f"  await {fn}(app);\n"
elif uses_devices_plain:
    # Fastify register with prefix
    register_call = f'  await app.register({fn}, {{ prefix: "/v1" }});\n'
else:
    # fallback: still register without prefix
    register_call = f"  await {fn}(app);\n"

# Insert call near other route registrations.
# Prefer after vpn registration if present, else near end before listen.
if fn in src and register_call.strip() not in src:
    # find a good insertion point: after registerVpnRoutes(app) if exists
    if "registerVpnRoutes" in src:
        src = re.sub(r'(await\s+registerVpnRoutes\(app\);\s*\n)', r'\1' + register_call, src, count=1)
    else:
        # before app.listen or before start
        src = re.sub(r'(await\s+app\.listen\([^\n]+\);\s*\n)', register_call + r'\1', src, count=1)

index_p.write_text(src, encoding="utf-8")

print("Patched index.ts to register devices routes.")
print("Route file:", route_file)
print("Exported fn:", fn)
print("Backup:", bak)
