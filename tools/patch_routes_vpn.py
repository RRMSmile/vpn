from __future__ import annotations
from pathlib import Path

p = Path("apps/api/src/routes/vpn.ts")
src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".bak")
bak.write_text(src, encoding="utf-8")

# 1) Fix provisionIosPeer call: pass prisma as first arg
src2 = src.replace(
    "const result = await provisionIosPeer(userId, body);",
    "const result = await provisionIosPeer(prisma, userId, body);",
)

# 2) Replace configTemplate: result.configTemplate with computed template
old_return = (
    "      return {\n"
    "        peerId: result.peer.id,\n"
    "        allowedIp: result.peer.allowedIp,\n"
    "        configTemplate: result.configTemplate,\n"
    "      };"
)

new_return = (
    "      // Build config template server-side (no need to store client private key)\n"
    "      const peerFull = await prisma.peer.findFirst({\n"
    "        where: { id: result.peer.id, userId },\n"
    "        include: { node: true },\n"
    "      });\n"
    "\n"
    "      if (!peerFull) return reply.code(500).send({ error: \"peer_not_found_after_provision\" });\n"
    "\n"
    "      const configTemplate = buildConfigTemplate({\n"
    "        addressIp: peerFull.allowedIp,\n"
    "        dns: env.WG_CLIENT_DNS,\n"
    "        serverPublicKey: peerFull.node.serverPublicKey,\n"
    "        endpointHost: peerFull.node.endpointHost,\n"
    "        endpointPort: peerFull.node.wgPort,\n"
    "      });\n"
    "\n"
    "      return {\n"
    "        peerId: result.peer.id,\n"
    "        allowedIp: result.peer.allowedIp,\n"
    "        configTemplate,\n"
    "      };"
)

if old_return not in src2:
    raise SystemExit("patch failed: expected return block not found (vpn.ts changed?)")

src2 = src2.replace(old_return, new_return)

# 3) Fix revokePeer call: pass prisma first arg
src2 = src2.replace(
    "const res = await revokePeer(userId, peerId);",
    "const res = await revokePeer(prisma, userId, peerId);",
)

p.write_text(src2, encoding="utf-8")
print("Patched routes/vpn.ts OK.")
print(f"Backup: {bak}")
