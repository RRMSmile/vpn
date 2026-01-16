import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma";
import { pickFreeIp } from "../lib/ip-pool";
import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";

function mustEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`${name} is empty`);
  return v;
}

type RegisterKeyBody = {
  deviceId: string;
  nodeId?: string;
  publicKey: string;
};

type RotateKeyBody = {
  deviceId: string;
  publicKey: string;
};

export async function registerVpnRoutes(app: FastifyInstance) {
  // Protect /vpn/* with existing JWT (cookie or bearer)
  app.addHook("preHandler", async (req) => {
    if (req.routerPath?.startsWith("/vpn")) {
      // @ts-ignore
      await req.jwtVerify();
    }
  });

  app.get("/vpn/nodes", async () => {
    const db = await prisma.vpnNode.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });

    if (db.length) {
      return {
        items: db.map((n) => ({
          id: n.id,
          name: n.name,
          endpoint: `${n.host}:${n.port}`,
          interface: n.interface,
        })),
      };
    }

    const host = mustEnv("WG_NODE_SSH_HOST");
    const port = Number(process.env.WG_SERVER_PORT || 51820);
    const iface = process.env.WG_INTERFACE || "wg0";

    return {
      items: [{ id: "default", name: "Default", endpoint: `${host}:${port}`, interface: iface }],
    };
  });

  // Register device publicKey => allocate IP => apply wg set via SSH => return profile/config
  app.post("/vpn/register-key", async (req, reply) => {
    const body = (req.body || {}) as Partial<RegisterKeyBody>;
    const deviceId = String(body.deviceId || "").trim();
    const nodeId = String(body.nodeId || "default").trim();
    const publicKey = String(body.publicKey || "").trim();

    if (!deviceId) return reply.code(400).send({ error: "deviceId required" });
    if (!publicKey) return reply.code(400).send({ error: "publicKey required" });

    // @ts-ignore
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return reply.code(401).send({ error: "no user" });

    // MVP: 1 device per user
    const anyDevice = await prisma.device.findFirst({ where: { userId } });
    if (anyDevice && anyDevice.deviceId !== deviceId) {
      return reply.code(409).send({ error: "DEVICE_LIMIT", canTransfer: true });
    }

    await prisma.device.upsert({
      where: { deviceId },
      update: { userId, platform: "ios" },
      create: { deviceId, userId, platform: "ios" },
    });

    // pick node (optional)
    let node: any = null;
    if (nodeId !== "default") node = await prisma.vpnNode.findUnique({ where: { id: nodeId } });

    const host = mustEnv("WG_NODE_SSH_HOST");
    const port = Number(process.env.WG_SERVER_PORT || 51820);
    const iface = process.env.WG_INTERFACE || "wg0";

    const endpoint = node ? `${node.host}:${node.port}` : `${host}:${port}`;
    const wgIface = node ? node.interface : iface;

    // If peer already exists for device -> return again (idempotent)
    const existingPeer = await prisma.vpnPeer.findFirst({ where: { deviceId } });
    if (existingPeer) {
      return {
        ok: true,
        address: existingPeer.allowedIp,
        config: buildConfig({
          clientIp: existingPeer.allowedIp,
          endpoint,
          serverPublicKey: mustEnv("WG_SERVER_PUBLIC_KEY"),
          dns: process.env.WG_CLIENT_DNS || "1.1.1.1",
        }),
      };
    }

    // Allocate next free IP from DB used set
    const peers = await prisma.vpnPeer.findMany({ select: { allowedIp: true } });
    const used = new Set(peers.map((p) => p.allowedIp));
    const ip = pickFreeIp(used);

    const nodeRow = node ? node : await ensureDefaultNode(host, port, wgIface);

    // Persist first, then apply wg; if wg fails -> rollback DB row
    const created = await prisma.vpnPeer.create({
      data: { userId, deviceId, nodeId: nodeRow.id, publicKey, allowedIp: ip },
    });

    try {
      await wgAddPeer({ iface: wgIface, publicKey, allowedIp: ip });
    } catch (e) {
      await prisma.vpnPeer.delete({ where: { id: created.id } }).catch(() => {});
      throw e;
    }

    return {
      ok: true,
      address: ip,
      config: buildConfig({
        clientIp: ip,
        endpoint,
        serverPublicKey: mustEnv("WG_SERVER_PUBLIC_KEY"),
        dns: process.env.WG_CLIENT_DNS || "1.1.1.1",
      }),
    };
  });

  // Rotate peer public key (keep same IP)
  app.post("/vpn/rotate-key", async (req, reply) => {
    const body = (req.body || {}) as Partial<RotateKeyBody>;
    const deviceId = String(body.deviceId || "").trim();
    const newPublicKey = String(body.publicKey || "").trim();

    if (!deviceId) return reply.code(400).send({ error: "deviceId required" });
    if (!newPublicKey) return reply.code(400).send({ error: "publicKey required" });

    // @ts-ignore
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return reply.code(401).send({ error: "no user" });

    const peer = await prisma.vpnPeer.findFirst({ where: { userId, deviceId } });
    if (!peer) return reply.code(404).send({ error: "peer not found" });

    const node = await prisma.vpnNode.findUnique({ where: { id: peer.nodeId } });
    const iface = node?.interface || (process.env.WG_INTERFACE || "wg0");

    await wgRemovePeer({ iface, publicKey: peer.publicKey });
    await wgAddPeer({ iface, publicKey: newPublicKey, allowedIp: peer.allowedIp });

    await prisma.vpnPeer.update({ where: { id: peer.id }, data: { publicKey: newPublicKey } });
    return { ok: true };
  });

  // Return current profile for device
  app.get("/vpn/profile", async (req, reply) => {
    const deviceId = String((req.query as any)?.deviceId || "").trim();
    if (!deviceId) return reply.code(400).send({ error: "deviceId required" });

    // @ts-ignore
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return reply.code(401).send({ error: "no user" });

    const peer = await prisma.vpnPeer.findFirst({ where: { userId, deviceId } });
    if (!peer) return reply.code(404).send({ error: "peer not found" });

    const node = await prisma.vpnNode.findUnique({ where: { id: peer.nodeId } });
    const host = node?.host || mustEnv("WG_NODE_SSH_HOST");
    const port = Number(node?.port || process.env.WG_SERVER_PORT || 51820);
    const endpoint = `${host}:${port}`;

    return {
      ok: true,
      address: peer.allowedIp,
      config: buildConfig({
        clientIp: peer.allowedIp,
        endpoint,
        serverPublicKey: mustEnv("WG_SERVER_PUBLIC_KEY"),
        dns: process.env.WG_CLIENT_DNS || "1.1.1.1",
      }),
    };
  });
}

async function ensureDefaultNode(host: string, port: number, iface: string) {
  const existing = await prisma.vpnNode.findFirst({ where: { host, port, interface: iface } });
  if (existing) return existing;
  return prisma.vpnNode.create({ data: { name: "Default", host, port, interface: iface } });
}

function buildConfig(params: { clientIp: string; dns: string; endpoint: string; serverPublicKey: string }) {
  const { clientIp, dns, endpoint, serverPublicKey } = params;
  return [
    "[Interface]",
    "PrivateKey = <DEVICE_PRIVATE_KEY>",
    `Address = ${clientIp}/32`,
    `DNS = ${dns}`,
    "",
    "[Peer]",
    `PublicKey = ${serverPublicKey}`,
    `Endpoint = ${endpoint}`,
    "AllowedIPs = 0.0.0.0/0, ::/0",
    "PersistentKeepalive = 25",
    "",
  ].join("\n");
}

