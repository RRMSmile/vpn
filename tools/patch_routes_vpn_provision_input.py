from __future__ import annotations
from pathlib import Path

p = Path("apps/api/src/routes/vpn.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".provinput.bak")
bak.write_text(src, encoding="utf-8")

src2 = src.replace(
  "const result = await provisionIosPeer(prisma, { userId, ...body });",
  "const result = await provisionIosPeer(prisma, { userId, publicKey: body.publicKey });",
)

p.write_text(src2, encoding="utf-8")
print("Patched routes/vpn.ts provision input OK.")
print(f"Backup: {bak}")
