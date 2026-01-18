from __future__ import annotations
from pathlib import Path
import re

p = Path("apps/api/src/index.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".devices.bak")
bak.write_text(src, encoding="utf-8")

# 1) add import if missing
if 'from "./routes/devices"' not in src:
    # insert after other route imports if possible
    m = re.search(r'(import\s+\{\s*registerVpnRoutes\s*\}\s+from\s+"\.\/routes\/vpn";\s*\n)', src)
    if m:
        src = src[:m.end()] + 'import { registerDeviceRoutes } from "./routes/devices";\n' + src[m.end():]
    else:
        # fallback: after first import block
        m2 = re.search(r'(\A(?:import[^\n]*\n)+)', src)
        if not m2:
            raise SystemExit("No import block found in index.ts")
        src = src[:m2.end()] + 'import { registerDeviceRoutes } from "./routes/devices";\n' + src[m2.end():]

# 2) call registerDeviceRoutes(app) after registerVpnRoutes(app)
if "await registerDeviceRoutes(app);" not in src:
    src = re.sub(r'(await\s+registerVpnRoutes\(app\);\s*\n)', r'\1  await registerDeviceRoutes(app);\n', src, count=1)

p.write_text(src, encoding="utf-8")
print("Patched index.ts OK.")
print(f"Backup: {bak}")
