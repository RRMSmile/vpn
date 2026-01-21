from __future__ import annotations
from pathlib import Path
import re

p = Path("apps/api/src/lib/vpn-provision.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".deviceid.bak")
bak.write_text(src, encoding="utf-8")

# 1) Ensure import Platform from @prisma/client (and PrismaClient already exists in file)
if "Platform" not in src:
    # try to augment an existing prisma import line
    m = re.search(r'import\s+\{\s*([^}]+)\s*\}\s+from\s+"@prisma/client";', src)
    if m:
        inside = m.group(1).strip()
        if "Platform" not in inside.split(","):
            new_inside = inside + ", Platform"
            src = src[:m.start()] + f'import {{ {new_inside} }} from "@prisma/client";' + src[m.end():]
    else:
        # if no named import exists, add one at top
        src = 'import { Platform } from "@prisma/client";\n' + src

# 2) Ensure import randomUUID from crypto
if "randomUUID" not in src:
    # place near top after other imports
    lines = src.splitlines(True)
    insert_at = 0
    # after last import line block
    for i, line in enumerate(lines):
        if line.startswith("import "):
            insert_at = i + 1
    lines.insert(insert_at, 'import { randomUUID } from "crypto";\n')
    src = "".join(lines)

# 3) Replace platform "IOS" usage in our wrapper lookup/create to Platform.IOS
src = src.replace('where: { userId, platform: "IOS" }', 'where: { userId, platform: Platform.IOS }')

# 4) Ensure device.create has deviceId and platform enum
# Replace the exact data object used by our fallback patch
src = src.replace(
    'data: { userId, platform: "IOS", name: "iphone" },',
    'data: { deviceId: randomUUID(), userId, platform: Platform.IOS, name: "iphone" },'
)

p.write_text(src, encoding="utf-8")
print("Patched vpn-provision.ts device create fields OK.")
print(f"Backup: {bak}")
