from __future__ import annotations
from pathlib import Path

p = Path("apps/api/src/routes/vpn.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".args2.bak")
bak.write_text(src, encoding="utf-8")

src2 = src

# provision: 3 args -> 2 args (prisma, { userId, ...body })
src2 = src2.replace(
  "const result = await provisionIosPeer(prisma, userId, body);",
  "const result = await provisionIosPeer(prisma, { userId, ...body });",
)

# revoke: 3 args -> 2 args (prisma, { userId, peerId })
src2 = src2.replace(
  "const res = await revokePeer(prisma, userId, peerId);",
  "const res = await revokePeer(prisma, { userId, peerId });",
)

p.write_text(src2, encoding="utf-8")
print("Patched routes/vpn.ts to 2-arg calls OK.")
print(f"Backup: {bak}")
