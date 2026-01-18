from __future__ import annotations
from pathlib import Path

p = Path("apps/api/src/lib/vpn-provision.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".wrappers.bak")
bak.write_text(src, encoding="utf-8")

# 0) Ensure we import zod and prisma types are present (we won't fight existing imports; just patch minimally)
# We'll inject wrapper code near bottom, right before default export if present.
marker = "export default"
if marker not in src:
    raise SystemExit("Cannot find export default marker to insert wrappers near bottom")

# 1) Remove old alias line if exists to avoid conflicts
src2 = src.replace("export const provisionIosPeer = provision;\n", "")

# 2) Ensure revokePeer alias is not present
src2 = src2.replace("export const revokePeer = revoke;\n", "")

wrapper_block = r'''
// Back-compat wrappers for route layer
// Route-level identity is userId; internal provision/revoke are deviceId-based.

export async function provisionIosPeer(
  prisma: PrismaClient,
  input: { userId: string; publicKey: string }
) {
  const { userId, publicKey } = input;

  // Find or create a canonical iOS device for this user
  const device = await prisma.device.upsert({
    where: { userId_platform: { userId, platform: "IOS" } },
    update: {},
    create: {
      userId,
      platform: "IOS",
      name: "iphone",
    },
  });

  return provision(prisma, { deviceId: device.id, publicKey });
}

export async function revokePeer(
  prisma: PrismaClient,
  input: { userId: string; peerId: string }
) {
  const { userId, peerId } = input;

  const peer = await prisma.peer.findFirst({
    where: { id: peerId, userId },
    select: { deviceId: true },
  });

  if (!peer) {
    const err: any = new Error("peer_not_found");
    err.code = "PEER_NOT_FOUND";
    throw err;
  }

  return revoke(prisma, { deviceId: peer.deviceId });
}
'''

# 3) Insert wrapper block before export default
parts = src2.split("export default", 1)
src3 = parts[0].rstrip() + "\n\n" + wrapper_block.strip() + "\n\nexport default" + parts[1]

p.write_text(src3, encoding="utf-8")
print("Patched vpn-provision.ts wrappers OK.")
print(f"Backup: {bak}")
