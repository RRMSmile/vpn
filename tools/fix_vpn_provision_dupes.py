from __future__ import annotations
from pathlib import Path

p = Path("apps/api/src/lib/vpn-provision.ts")
src = p.read_text(encoding="utf-8")

bak = p.with_suffix(p.suffix + ".dupefix.bak")
bak.write_text(src, encoding="utf-8")

lines = src.splitlines(True)

# Remove duplicate ProvisionInputSchema exports: keep the first occurrence only
out = []
seen_schema = 0
for line in lines:
    if "export const ProvisionInputSchema" in line:
        seen_schema += 1
        if seen_schema >= 2:
            continue
    out.append(line)

src2 = "".join(out)

# Remove duplicate "name: env.WG_NODE_ID," inside node create object: keep only first per create block
# Simple approach: collapse consecutive duplicate lines anywhere
src2_lines = src2.splitlines(True)
out2 = []
prev = None
for line in src2_lines:
    if prev == line and line.strip() in {"name: env.WG_NODE_ID,", "name: env.WG_NODE_ID,"}:
        continue
    out2.append(line)
    prev = line

src3 = "".join(out2)

p.write_text(src3, encoding="utf-8")
print("Dupe-fix applied.")
print(f"Backup: {bak}")
