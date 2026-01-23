import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../env";
import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";
import { allocateAllowedIp as allocateAllowedIp } from "../lib/ipAllocator";
import { generateWgKeypair, normalizePublicKey, WG_PUBLIC_KEY_RE } from "../lib/wg-keys";

const PEER_TTL_MS = Number(process.env.PEER_TTL_MS ?? "300000"); // 5 минут по умолчанию

function buildWgClientConfig(args: {
  clientPrivateKey: string | null;
  clientAddress: string; // e.g. 10.0.0.2/32
  serverPublicKey: string;
  endpointHost: string;
  wgPort: number;
}) {
  const endpoint = `${args.endpointHost}:${args.wgPort}`;

  return (
    `[Interface]\n` +
    (args.clientPrivateKey ? `PrivateKey = ${args.clientPrivateKey}\n` : "") +
    `Address = ${args.clientAddress}\n` +
    `DNS = 1.1.1.1\n\n` +
    `[Peer]\n` +
    `PublicKey = ${args.serverPublicKey}\n` +
    `AllowedIPs = 0.0.0.0/0, ::/0\n` +
    `Endpoint = ${endpoint}\n` +
    `PersistentKeepalive = 25\n`
  );
}

async function ensureNode() {
  const nodeId = process.env.WG_NODE_ID ?? "wg-node-1";

  // endpointHost/wgPort are required by Prisma schema -> must not be undefined
  const endpointHost =
    process.env.WG_ENDPOINT_HOST ??
    process.env.WG_NODE_ENDPOINT_HOST ??
    env.WG_NODE_SSH_HOST;

  const wgPort = Number(process.env.WG_PORT ?? process.env.WG_NODE_WG_PORT ?? "51820");

  let node = await prisma.node.findUnique({
    where: { id: nodeId } as any,
  });

  if (node) {
    // Обновляем техполя, но НЕ трогаем serverPublicKey: источник правды — БД
    node = await prisma.node.update({
      where: { id: nodeId } as any,
      data: {
        name: nodeId,
        endpointHost,
        wgPort,
        sshHost: env.WG_NODE_SSH_HOST,
        sshUser: env.WG_NODE_SSH_USER,
        wgInterface: env.WG_INTERFACE,
      } as any,
    });
  } else {
    // первый bootstrap ноды: ключ обязателен только для create
    const serverPublicKey = env.WG_SERVER_PUBLIC_KEY;
    if (!serverPublicKey) throw new Error("WG_SERVER_PUBLIC_KEY_REQUIRED_FOR_NODE_CREATE");

    node = await prisma.node.create({
      data: {
        id: nodeId,
        name: nodeId,
        endpointHost,
        wgPort,
        sshHost: env.WG_NODE_SSH_HOST,
        sshUser: env.WG_NODE_SSH_USER,
        wgInterface: env.WG_INTERFACE,
        serverPublicKey,
      } as any,
    });
  }

  if (!node.serverPublicKey) throw new Error("NODE_SERVER_PUBLIC_KEY_MISSING");
  return node;
}



const CreateDeviceSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  name: z.string().min(1),
});

const ProvisionSchema = z.object({
  publicKey: z
    .string()
    .transform((v) => normalizePublicKey(v))
    .refine((v) => WG_PUBLIC_KEY_RE.test(v), { message: "invalid_wireguard_public_key" })
    .optional(),
});
export async function registerDeviceRoutes(app: FastifyInstance) {
  // GET /health already exists elsewhere

  // POST /v1/devices (idempotent by userId+platform+name)
  app.post("/v1/devices", async (req: any, reply) => {
    const body = CreateDeviceSchema.parse(req.body);    // ensure user exists (Device.userId has FK)
    await prisma.user.upsert({
      where: { id: body.userId },
      update: {},
      create: {
        id: body.userId,
        email: `${body.userId}@users.cloudgate.local`,
      },
    });

    const existing = await prisma.device.findFirst({
      where: { userId: body.userId, platform: body.platform, name: body.name },
      select: { id: true, deviceId: true },
    });

    if (existing) {
      return reply.code(200).send({ id: existing.id, deviceId: existing.deviceId, existing: true });
    }

const created = await prisma.device.create({
      data: {
        deviceId: crypto.randomUUID(),
        userId: body.userId,
        platform: body.platform,
        name: body.name,
      } as any,
      select: { id: true, deviceId: true },
    });

    return reply.code(201).send({ id: created.id, deviceId: created.deviceId, existing: false });
  });

  // GET /v1/devices/:id
  app.get("/v1/devices/:id", async (req: any, reply) => {
    const id = z.string().min(1).parse((req.params as any).id);

    const device = await prisma.device.findUnique({
      where: { id } as any,
    });

    if (!device) return reply.code(404).send({ error: "device_not_found" });
    return device;
  });
  // POST /v1/devices/:id/provision
  app.post("/v1/devices/:id/provision", async (req: any, reply) => {
    const id = z.string().min(1).parse((req.params as any).id);

    // publicKey optional:
    // - iOS flow: app provides publicKey, server MUST NOT generate or store privateKey
    // - bot flow: publicKey omitted -> server generates keypair and returns privateKey in clientConfig
    const body = ProvisionSchema.parse(req.body ?? {});
    const providedPublicKey = (body as any)?.publicKey;

    let clientPublicKey = "";
    let clientPrivateKey: string | null = null;

    if (typeof providedPublicKey === "string" && providedPublicKey.trim().length > 0) {
      clientPublicKey = providedPublicKey.trim();
      clientPrivateKey = null;
    } else {
      const kp = generateWgKeypair();
      clientPublicKey = kp.publicKey;
      clientPrivateKey = kp.privateKey;
    }

    const device = await prisma.device.findUnique({ where: { id } as any });
    if (!device) return reply.code(404).send({ error: "device_not_found" });

    const node = await ensureNode();

    // idempotent: active peer exists -> return config, do not create another
    const active = await prisma.peer.findFirst({
      where: { deviceId: device.id, nodeId: node.id, revokedAt: null },
      orderBy: { createdAt: "desc" } as any,
    });

    if (active) {
      
      const refreshed = await prisma.peer.update({
        where: { id: active.id },
        data: { expiresAt: new Date(Date.now() + PEER_TTL_MS) } as any,
      });
const cfg = buildWgClientConfig({
        clientPrivateKey,
        clientAddress: `${refreshed.allowedIp}/32`,
        serverPublicKey: node.serverPublicKey,
        endpointHost: node.endpointHost,
        wgPort: node.wgPort,
      });

      return reply.code(200).send({
        existing: true,
        peerId: active.id,
        allowedIp: refreshed.allowedIp,
        nodeId: node.id,
        endpoint: `${node.endpointHost}:${node.wgPort}`,
        serverPublicKey: node.serverPublicKey,
        clientConfig: cfg,
      });
    }

    // allocate IP + create peer (retry on unique constraint nodeId+allowedIp)
    let created: any = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const allowedIp = await allocateAllowedIp(prisma, {
nodeId: node.id,
      start: process.env.WG_POOL_START ?? "10.8.0.2",
      end: process.env.WG_POOL_END ?? "10.8.0.254",
      });
      try {
        created = await prisma.peer.create({
          data: {
        expiresAt: new Date(Date.now() + PEER_TTL_MS),
        nodeId: node.id,
        deviceId: device.id,
        userId: device.userId,
        publicKey: clientPublicKey,
        allowedIp,
        revokedAt: null,
          } as any,
        });
        break;
      } catch (err: any) {
        if (err?.code === "P2002" && Array.isArray(err?.meta?.target) &&
            err.meta.target.includes("nodeId") && err.meta.target.includes("allowedIp")) {
          console.warn(`peer.create conflict attempt=${attempt} ip=${allowedIp} -> retry`);
          continue;
        }
        throw err;
      }
    }
    if (!created) {
      throw new Error("PEER_CREATE_CONFLICT_AFTER_RETRIES");
    }
try {
      await wgAddPeer({
        publicKey: created.publicKey,
        allowedIp: created.allowedIp,
        node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },
      });
    } catch (e: any) {
      req.log?.error({ err: e }, "wgAddPeer failed");
      await prisma.peer.update({
        where: { id: created.id } as any,
        data: { revokedAt: new Date() },
      });
      return reply.code(502).send({ error: "WG_ADD_FAILED" });
    }

    const cfg = buildWgClientConfig({
      clientPrivateKey,
      clientAddress: `${created.allowedIp}/32`,
      serverPublicKey: node.serverPublicKey,
      endpointHost: node.endpointHost,
      wgPort: node.wgPort,
    });

    return reply.code(201).send({
      existing: false,
      peerId: created.id,
      allowedIp: created.allowedIp,
      nodeId: node.id,
      endpoint: `${node.endpointHost}:${node.wgPort}`,
      serverPublicKey: node.serverPublicKey,
      clientConfig: cfg,
    });
  });

  // POST /v1/devices/:id/revoke
  app.post("/v1/devices/:id/revoke", async (req: any, reply) => {
    const id = z.string().min(1).parse((req.params as any).id);

    const device = await prisma.device.findUnique({ where: { id } as any });
    if (!device) return reply.code(404).send({ error: "device_not_found" });

    const node = await ensureNode();

    const active = await prisma.peer.findFirst({
      where: { deviceId: device.id, nodeId: node.id, revokedAt: null },
      orderBy: { createdAt: "desc" } as any,
    });

    if (!active) return reply.code(200).send({ revoked: false });

    // remove peer from WireGuard node
    // tolerate "peer missing" (DB might contain a peer created before ssh was fixed)
    try {
      await wgRemovePeer({
        publicKey: active.publicKey,
        node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },
      });
    } catch (e: any) {
      const msg = String((e && ((e as any).stderr || (e as any).message)) || "");
      if (!/no such peer|not found/i.test(msg)) {
        req.log?.error({ err: e }, "wgRemovePeer failed");
        return reply.code(502).send({ error: "WG_REMOVE_FAILED" });
      }
      req.log?.warn({ err: e }, "wgRemovePeer failed but ignoring (peer missing)");
    }

    await prisma.peer.update({
      where: { id: active.id } as any,
      data: { revokedAt: new Date() },
    });

    return reply.code(200).send({ revoked: true, deviceId: device.id, nodeId: node.id });
  });

}
