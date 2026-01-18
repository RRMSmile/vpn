from __future__ import annotations
from pathlib import Path
import re

p = Path("apps/api/src/routes/devices.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".envfix.bak")
bak.write_text(src, encoding="utf-8")

# 1) Replace ensureNode() implementation with process.env fallbacks
pattern = re.compile(r"async function ensureNode\(\)\s*\{.*?\n\}\n", re.S)

replacement = r'''async function ensureNode() {
  const nodeId = process.env.WG_NODE_ID ?? "wg-node-1";

  // endpointHost/wgPort are required by Prisma schema -> must not be undefined
  const endpointHost =
    process.env.WG_ENDPOINT_HOST ??
    process.env.WG_NODE_ENDPOINT_HOST ??
    env.WG_NODE_SSH_HOST;

  const wgPort = Number(process.env.WG_PORT ?? process.env.WG_NODE_WG_PORT ?? "51820");

  const node = await prisma.node.upsert({
    where: { id: nodeId } as any,
    update: {
      name: nodeId,
      endpointHost,
      wgPort,
      sshHost: env.WG_NODE_SSH_HOST,
      sshUser: env.WG_NODE_SSH_USER,
      wgInterface: env.WG_INTERFACE,
      serverPublicKey: env.WG_SERVER_PUBLIC_KEY,
    } as any,
    create: {
      id: nodeId,
      name: nodeId,
      endpointHost,
      wgPort,
      sshHost: env.WG_NODE_SSH_HOST,
      sshUser: env.WG_NODE_SSH_USER,
      wgInterface: env.WG_INTERFACE,
      serverPublicKey: env.WG_SERVER_PUBLIC_KEY,
    } as any,
  });

  return node;
}
'''

if not pattern.search(src):
    raise SystemExit("ensureNode() block not found (devices.ts changed).")

src2 = pattern.sub(replacement, src, count=1)

# 2) Replace remaining env.WG_NODE_ID usage in revoke with process.env fallback
src2 = src2.replace(
    'const nodeId = env.WG_NODE_ID ?? "wg-node-1";',
    'const nodeId = process.env.WG_NODE_ID ?? "wg-node-1";'
)

p.write_text(src2, encoding="utf-8")
print("Patched devices.ts env fallbacks OK.")
print(f"Backup: {bak}")
