from __future__ import annotations
from pathlib import Path

p = Path("apps/api/src/lib/vpn-provision.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".devlookup.bak")
bak.write_text(src, encoding="utf-8")

old = """  const device = await prisma.device.upsert({
    where: { userId_platform: { userId, platform: "IOS" } },
    update: {},
    create: {
      userId,
      platform: "IOS",
      name: "iphone",
    },
  });"""

new = """  let device = await prisma.device.findFirst({
    where: { userId, platform: "IOS" },
  });

  if (!device) {
    device = await prisma.device.create({
      data: { userId, platform: "IOS", name: "iphone" },
    });
  }"""

if old not in src:
    raise SystemExit("Expected upsert block not found; vpn-provision.ts differs from patch assumptions")

p.write_text(src.replace(old, new), encoding="utf-8")
print("Patched device lookup fallback OK.")
print(f"Backup: {bak}")
