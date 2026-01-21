import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../env";

// строгая проверка WireGuard publicKey (base64, 44 chars, заканчивается "=")
const WG_PUBLIC_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

function normalizePublicKey(v: string): string {
  return (v ?? "").trim();
}

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
  return [ (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255 ].join(".");
}

async function allocateIpFirstFree(opts: { start: string; end: string; nodeId: string }) {
  const start = ipToInt(opts.start);
  const end = ipToInt(opts.end);
  if (end < start) throw new Error(`WG pool end < start: ${opts.start}..${opts.end}`);

  const active = await prisma.peer.findMany({
    where: { nodeId: opts.nodeId, revokedAt: null },
    select: { allowedIp: true },
  });
  const used = new Set(active.map((p) => p.allowedIp));

  for (let i = start; i <= end; i++) {
    const ip = intToIp(i);
    if (!used.has(ip)) return ip;
  }

  const err: any = new Error(`WG pool exhausted (${opts.start}..${opts.end})`);
  err.code = "WG_POOL_EXHAUSTED";
  throw err;
}

async function ensureNode() {
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

const CreateDeviceSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  name: z.string().min(1),
});

const ProvisionSchema = z.object({
  publicKey: z
    .string()
    .transform((v) => normalizePublicKey(v))
    .refine((v) => WG_PUBLIC_KEY_RE.test(v), { message: "invalid_wireguard_public_key" }),
});

export async function registerDeviceRoutes(app: FastifyInstance) {
  // GET /health already exists elsewhere

  // POST /v1/devices (idempotent by userId+platform+name)
  app.post("/v1/devices", async (req: any, reply) => {
    const body = CreateDeviceSchema.parse(req.body);

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
    const body = ProvisionSchema.parse(req.body);

    const device = await prisma.device.findUnique({ where: { id } as any });
    if (!device) return reply.code(404).send({ error: "device_not_found" });

    const node = await ensureNode();

    // re-provision logic for (nodeId, publicKey) ignoring revokedAt
    const existingPeer = await prisma.peer.findFirst({
      where: { nodeId: node.id, publicKey: body.publicKey },
      orderBy: { createdAt: "desc" } as any,
    });

    if (existingPeer) {
      if (existingPeer.deviceId !== device.id) {
        return reply.code(409).send({ error: "PUBLIC_KEY_IN_USE" });
      }

      // same device -> idempotent "unrevoke" if needed
      const peer = await prisma.peer.update({
        where: { id: existingPeer.id } as any,
        data: { revokedAt: null },
      });

      return reply.code(200).send({
        node: {
          id: node.id,
          endpointHost: node.endpointHost,
          wgPort: node.wgPort,
          serverPublicKey: node.serverPublicKey,
        },
        peer,
      });
    }

    // allocate new IP
    const allowedIp = await allocateIpFirstFree({
      nodeId: node.id,
      start: env.WG_POOL_START,
      end: env.WG_POOL_END,
    });

    const peer = await prisma.peer.create({
      data: {
        nodeId: node.id,
        deviceId: device.id,
        userId: device.userId,
        publicKey: body.publicKey,
        allowedIp,
      } as any,
    });

    return reply.code(201).send({
      node: {
        id: node.id,
        endpointHost: node.endpointHost,
        wgPort: node.wgPort,
        serverPublicKey: node.serverPublicKey,
      },
      peer,
    });
  });

  // POST /v1/devices/:id/revoke
  app.post("/v1/devices/:id/revoke", async (req: any, reply) => {
    const id = z.string().min(1).parse((req.params as any).id);

    const device = await prisma.device.findUnique({ where: { id } as any });
    if (!device) return reply.code(404).send({ error: "device_not_found" });

    const nodeId = process.env.WG_NODE_ID ?? "wg-node-1";

    const active = await prisma.peer.findFirst({
      where: { deviceId: device.id, nodeId, revokedAt: null },
      orderBy: { createdAt: "desc" } as any,
    });

    if (!active) return reply.code(200).send({ revoked: false });

    await prisma.peer.update({
      where: { id: active.id } as any,
      data: { revokedAt: new Date() },
    });

    return reply.code(200).send({ revoked: true, peerId: active.id });
  });
}
