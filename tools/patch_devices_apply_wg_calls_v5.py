from __future__ import annotations
from pathlib import Path
import sys

p = Path("apps/api/src/routes/devices.ts")
if not p.exists():
    print("ERR: devices.ts not found", file=sys.stderr)
    sys.exit(2)

src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".wgapply5.bak")
bak.write_text(src, encoding="utf-8")

if "wgAddPeer(" in src or "wgRemovePeer(" in src:
    print("WARN: wg calls already present in devices.ts; abort to avoid double insert")
    print("Backup:", bak)
    sys.exit(0)

# 1) ensure import
needle_import = 'import { env } from "../env";\n'
if needle_import in src and 'from "../lib/wg-node"' not in src:
    src = src.replace(
        needle_import,
        needle_import + 'import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n',
        1
    )
elif 'from "../lib/wg-node"' not in src:
    print("ERR: cannot insert wg-node import (env import not found). Put it manually near imports.", file=sys.stderr)
    print("Backup:", bak, file=sys.stderr)
    sys.exit(3)

# 2) provision: after peer UPDATE (existingPeer branch)
anchor_update = """      const peer = await prisma.peer.update({
        where: { id: existingPeer.id } as any,
        data: { revokedAt: null },
      });

      return reply.code(200).send({
"""
inject_update = """      const peer = await prisma.peer.update({
        where: { id: existingPeer.id } as any,
        data: { revokedAt: null },
      });

      // apply peer on WireGuard node (idempotent)
      try {
        await wgAddPeer({
          publicKey: peer.publicKey,
          allowedIp: peer.allowedIp,
          node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },
        });
      } catch (e: any) {
        req.log?.error({ err: e }, "wgAddPeer failed");
        return reply.code(502).send({ error: "WG_ADD_FAILED" });
      }

      return reply.code(200).send({
"""
if anchor_update not in src:
    print("ERR: provision UPDATE anchor not found (existingPeer branch changed)", file=sys.stderr)
    print("Backup:", bak, file=sys.stderr)
    sys.exit(4)
src = src.replace(anchor_update, inject_update, 1)

# 3) provision: after peer CREATE (new peer branch)
anchor_create = """    const peer = await prisma.peer.create({
      data: {
        nodeId: node.id,
        deviceId: device.id,
        userId: device.userId,
        publicKey: body.publicKey,
        allowedIp,
      } as any,
    });

    return reply.code(201).send({
"""
inject_create = """    const peer = await prisma.peer.create({
      data: {
        nodeId: node.id,
        deviceId: device.id,
        userId: device.userId,
        publicKey: body.publicKey,
        allowedIp,
      } as any,
    });

    // apply peer on WireGuard node (ssh)
    try {
      await wgAddPeer({
        publicKey: peer.publicKey,
        allowedIp: peer.allowedIp,
        node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },
      });
    } catch (e: any) {
      req.log?.error({ err: e }, "wgAddPeer failed");
      return reply.code(502).send({ error: "WG_ADD_FAILED" });
    }

    return reply.code(201).send({
"""
if anchor_create not in src:
    print("ERR: provision CREATE anchor not found (new peer branch changed)", file=sys.stderr)
    print("Backup:", bak, file=sys.stderr)
    sys.exit(5)
src = src.replace(anchor_create, inject_create, 1)

# 4) revoke: use ensureNode() so we have sshHost/sshUser/wgInterface
anchor_revoke_nodeid = """    const nodeId = process.env.WG_NODE_ID ?? "wg-node-1";

    const active = await prisma.peer.findFirst({
      where: { deviceId: device.id, nodeId, revokedAt: null },
      orderBy: { createdAt: "desc" } as any,
    });
"""
inject_revoke_node = """    const node = await ensureNode();

    const active = await prisma.peer.findFirst({
      where: { deviceId: device.id, nodeId: node.id, revokedAt: null },
      orderBy: { createdAt: "desc" } as any,
    });
"""
if anchor_revoke_nodeid not in src:
    print("ERR: revoke nodeId anchor not found (revoke branch changed)", file=sys.stderr)
    print("Backup:", bak, file=sys.stderr)
    sys.exit(6)
src = src.replace(anchor_revoke_nodeid, inject_revoke_node, 1)

# 5) revoke: call wgRemovePeer BEFORE marking revokedAt
anchor_revoke_update = """    await prisma.peer.update({
      where: { id: active.id } as any,
      data: { revokedAt: new Date() },
    });

    return reply.code(200).send({ revoked: true, peerId: active.id });
"""
inject_revoke_update = """    // remove peer from WireGuard node (strict: if fail -> do not mark revoked)
    try {
      await wgRemovePeer({
        publicKey: active.publicKey,
        node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },
      });
    } catch (e: any) {
      req.log?.error({ err: e }, "wgRemovePeer failed");
      return reply.code(502).send({ error: "WG_REMOVE_FAILED" });
    }

    await prisma.peer.update({
      where: { id: active.id } as any,
      data: { revokedAt: new Date() },
    });

    return reply.code(200).send({ revoked: true, peerId: active.id });
"""
if anchor_revoke_update not in src:
    print("ERR: revoke update anchor not found (revoke branch changed)", file=sys.stderr)
    print("Backup:", bak, file=sys.stderr)
    sys.exit(7)
src = src.replace(anchor_revoke_update, inject_revoke_update, 1)

p.write_text(src, encoding="utf-8")
print("OK: patched devices.ts v5 (wgAddPeer/wgRemovePeer wired)")
print("Backup:", bak)
