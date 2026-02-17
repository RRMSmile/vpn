// IP allocation logic for WG peers
import type { PrismaClient } from "@prisma/client";

function ipToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`Invalid IPv4: ${ip}`);
  const nums = parts.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`Invalid IPv4: ${ip}`);
    return n;
  });
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
}

function intToIp(n: number): string {
  return [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ].join(".");
}

// Allocate only from ACTIVE peers (revokedAt = null).
// Revoked peers must not hold pool capacity.
export async function allocateAllowedIp(
  prisma: PrismaClient,
  opts: { nodeId: string; start: string; end: string }
): Promise<string> {
  const startN = ipToInt(opts.start);
  const endN = ipToInt(opts.end);
  if (startN > endN) throw new Error(`WG_POOL_START > WG_POOL_END (${opts.start}..${opts.end})`);

  const activePeers = await prisma.peer.findMany({
    where: { nodeId: opts.nodeId, revokedAt: null },
    select: { allowedIp: true },
  });

  const used = new Set(activePeers.map((p) => p.allowedIp));

  for (let cur = startN; cur <= endN; cur++) {
    const ip = intToIp(cur);
    if (!used.has(ip)) return ip;
  }

  const err: any = new Error("WG_POOL_EXHAUSTED");
  err.code = "WG_POOL_EXHAUSTED";
  throw err;
}
