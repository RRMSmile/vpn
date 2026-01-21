import { prisma } from "../lib/prisma";
import { wgRemovePeer } from "../lib/wg-node";

const WG_REMOVE_TIMEOUT_MS = Number(process.env.WG_REMOVE_TIMEOUT_MS ?? "4000");
const REVOKE_CONCURRENCY = Number(process.env.REVOKE_CONCURRENCY ?? "8");
const REVOKE_TAKE = Number(process.env.REVOKE_TAKE ?? "200");

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race<T>([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("WG_REMOVE_TIMEOUT")), ms)
    ),
  ]);
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
) {
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) break;
        await worker(items[idx]);
      }
    })
  );
}

type RevokeStats = {
  found: number;
  dbRevoked: number;
  wgOk: number;
  wgFail: number;
  missingNode: number;
};

export async function revokeExpiredOnce(): Promise<RevokeStats> {
  const now = new Date();

  const expired = await prisma.peer.findMany({
    where: { revokedAt: null, expiresAt: { lte: now } } as any,
    select: { id: true, publicKey: true, nodeId: true } as any,
    take: REVOKE_TAKE,
  });

  if (!expired.length) {
    return { found: 0, dbRevoked: 0, wgOk: 0, wgFail: 0, missingNode: 0 };
  }

  // DB: mark revoked (source of truth)
  const upd = await prisma.peer.updateMany({
    where: { id: { in: expired.map((p: any) => p.id) }, revokedAt: null } as any,
    data: { revokedAt: now } as any,
  });

  const nodeIds = Array.from(new Set(expired.map((p: any) => p.nodeId).filter(Boolean)));
  const nodes = await prisma.node.findMany({
    where: { id: { in: nodeIds } } as any,
  });

  const nodeMap = new Map((nodes as any[]).map((n) => [n.id, n]));

  let wgOk = 0;
  let wgFail = 0;
  let missingNode = 0;

  await runPool(expired as any[], REVOKE_CONCURRENCY, async (peer: any) => {
    const node = nodeMap.get(peer.nodeId);
    if (!node) {
      missingNode++;
      return;
    }
    try {
      await withTimeout(
        wgRemovePeer({ publicKey: peer.publicKey, node } as any),
        WG_REMOVE_TIMEOUT_MS
      );
      wgOk++;
    } catch {
      wgFail++;
      // silent; next tick retry
    }
  });

  return {
    found: expired.length,
    dbRevoked: (upd as any).count ?? expired.length,
    wgOk,
    wgFail,
    missingNode,
  };
}
