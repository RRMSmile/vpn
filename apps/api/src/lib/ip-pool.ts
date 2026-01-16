import { PrismaClient } from "@prisma/client";

function ipToInt(ip: string): number {
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((x) => Number.isNaN(x) || x < 0 || x > 255)) {
    throw new Error(`Invalid IPv4: ${ip}`);
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function intToIp(n: number): string {
  const a = (n >>> 24) & 255;
  const b = (n >>> 16) & 255;
  const c = (n >>> 8) & 255;
  const d = n & 255;
  return `${a}.${b}.${c}.${d}`;
}

export async function allocateIp(params: {
  prisma: PrismaClient;
  startIp: string;
  endIp: string;
}) {
  const start = ipToInt(params.startIp);
  const end = ipToInt(params.endIp);
  if (end < start) throw new Error("WG_POOL_END must be >= WG_POOL_START");

  // Берём занятые allowedIp из Peer (ожидается, что там хранится "10.8.0.X")
  const peers = await params.prisma.peer.findMany({
    select: { allowedIp: true, revokedAt: true },
  });

  const used = new Set<number>();
  for (const p of peers) {
    if (!p.allowedIp) continue;
    // считаем занятым только активных
    if (p.revokedAt) continue;
    try {
      used.add(ipToInt(p.allowedIp));
    } catch {
      // игнорим мусор
    }
  }

  for (let n = start; n <= end; n++) {
    if (!used.has(n)) return intToIp(n);
  }

  throw new Error("IP pool exhausted");
}
