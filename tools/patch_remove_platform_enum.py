from __future__ import annotations
from pathlib import Path
import re

p = Path("apps/api/src/lib/vpn-provision.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".noplatform.bak")
bak.write_text(src, encoding="utf-8")

# 1) Remove Platform from prisma import (if present)
src = re.sub(
    r'import\s+\{\s*([^}]*?)\s*\}\s+from\s+"@prisma/client";',
    lambda m: 'import { ' + ", ".join([x.strip() for x in m.group(1).split(",") if x.strip() and x.strip() != "Platform"]) + ' } from "@prisma/client";',
    src,
    count=1
)

# 2) Replace Platform.IOS -> "IOS"
src = src.replace("platform: Platform.IOS", 'platform: "IOS"')
src = src.replace('platform: Platform.IOS', 'platform: "IOS"')

p.write_text(src, encoding="utf-8")
print("Patched vpn-provision.ts: removed Platform enum usage.")
print(f"Backup: {bak}")
