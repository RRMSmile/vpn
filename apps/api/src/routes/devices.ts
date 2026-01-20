
function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

// WireGuard keys: X25519 keypair, base64 encoded
function generateWgKeypair() {
  const kp = nacl.box.keyPair();
  // nacl uses Uint8Array keys (32 bytes). WG expects base64.
  const privateKey = b64(kp.secretKey);
  const publicKey = b64(kp.publicKey);
  return { privateKey, publicKey };
}

function buildWgClientConfig(args: {
  clientPrivateKey: string;
  clientAddress: string; // e.g. 10.0.0.2/32
  serverPublicKey: string;
  endpointHost: string;
  wgPort: number;
}) {
  const endpoint = `${args.endpointHost}:${args.wgPort}`;
  return (
    `[Interface]\n` +
    `PrivateKey = ${args.clientPrivateKey}\n` +
    `Address = ${args.clientAddress}\n` +
    `DNS = 1.1.1.1\n\n` +
    `[Peer]\n` +
    `PublicKey = ${args.serverPublicKey}\n` +
    `AllowedIPs = 0.0.0.0/0, ::/0\n` +
    `Endpoint = ${endpoint}\n` +
    `PersistentKeepalive = 25\n`
  );
}

import type { FastifyInstance } from "fastify";
import nacl from "tweetnacl";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../env";
import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";

// строгая проверка WireGuard publicKey (base64, 44 chars, заканчивается "=")
const WG_PUBLIC_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

function normalizePublicKey(v: string): string {
  // remove CR/LF and any surrounding whitespace
  return String(v ?? "")
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .trim();
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
    where: { nodeId: opts.nodeId },
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

    // DEBUG: enable with DEBUG_PROVISION=1
    if ((process.env.DEBUG_PROVISION ?? "").trim() === "1") {
      const pk = (req.body as any)?.publicKey;
      req.log?.info(
        { publicKey: pk, len: typeof pk === "string" ? pk.length : null, type: typeof pk },
        "provision payload"
      );
    }

      const body = ProvisionSchema.parse(req.body);

// For Telegram MVP: if publicKey not provided, generate keypair server-side.
// If provided (iOS app), keep it and do not generate privateKey.
let clientPrivateKey: string | null = null;
let clientPublicKey: string | null = null;

if (body.publicKey) {
  clientPublicKey = body.publicKey;
} else {
  const kp = generateWgKeypair();
  clientPrivateKey = kp.privateKey;
  clientPublicKey = kp.publicKey;
}
const device = await prisma.device.findUnique({ where: { id } as any });
    if (!device) return reply.code(404).send({ error: "device_not_found" });
      // --- subscription gate (MVP) ---
      let sub = await prisma.subscription.findUnique({ where: { userId: device.userId } as any });
      const now = new Date();

      // If no subscription yet, grant one-time 24h trial.
      if (!sub) {
        const trialPlan = await prisma.plan.upsert({
          where: { code: "TRIAL24" },
          update: {},
          create: {
            code: "TRIAL24",
            title: "Trial 24h",
            priceKopeks: 0,
            durationDays: 1,
            deviceLimit: 1,
            isActive: true,
          },
        });

        const activeFrom = now;
        const activeUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        sub = await prisma.subscription.create({
          data: {
            userId: device.userId,
            planId: trialPlan.id,
            status: "TRIAL",
            activeFrom,
            activeUntil,
            deviceLimit: trialPlan.deviceLimit,
          } as any,
        });
      }

      // Allow provisioning only for ACTIVE/TRIAL subscriptions.
      if (sub.status !== "ACTIVE" && sub.status !== "TRIAL") {
        return reply.code(402).send({ error: "SUBSCRIPTION_REQUIRED" });
      }

      // Block if expired
      if (sub.activeUntil && new Date(sub.activeUntil).getTime() <= now.getTime()) {
        return reply.code(402).send({ error: sub.status === "TRIAL" ? "TRIAL_EXPIRED" : "SUBSCRIPTION_EXPIRED" });
      }

      const deviceLimit = Number((sub as any).deviceLimit ?? 0);
      if (!Number.isFinite(deviceLimit) || deviceLimit <= 0) {
        return reply.code(403).send({ error: "SUBSCRIPTION_INVALID_LIMIT" });
      }

      const node = await ensureNode();
    // re-provision logic for (nodeId, publicKey) ignoring revokedAt
    const existingPeer = await prisma.peer.findFirst({
      where: { nodeId: node.id, publicKey: clientPublicKey },
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

      // apply peer on WireGuard node (idempotent)
      try {
        await wgAddPeer({
          publicKey: peer.publicKey,
          allowedIp: peer.allowedIp,
          node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },
        });
      } catch (e: any) {
        // rollback "unrevoke" so it doesn't block future provisions
        await prisma.peer.update({
          where: { id: peer.id } as any,
          data: { revokedAt: new Date() },
        });

        req.log?.error({ err: e }, "wgAddPeer failed");
        return reply.code(502).send({ error: "WG_ADD_FAILED" });
      }

      return reply.code(200).send({
          node: {
          id: node.id,
          endpointHost: node.endpointHost,
          wgPort: node.wgPort,
          serverPublicKey: node.serverPublicKey,
        },
          peer,
          clientConfig: buildWgClientConfig({
            clientPrivateKey: (peer as any).privateKey,
            clientAddress: `${peer.allowedIp}/32`,
            serverPublicKey: node.serverPublicKey,
            endpointHost: node.endpointHost,
            wgPort: node.wgPort,
          }),
        });
    }
    // one active peer per device (MVP). if already provisioned -> revoke first
    const activePeerForDevice = await prisma.peer.findFirst({
      where: { deviceId: device.id, nodeId: node.id, revokedAt: null } as any,
      orderBy: { createdAt: "desc" } as any,
    });
    if (activePeerForDevice) {
        return reply.code(200).send({
          node: {
            id: node.id,
            endpointHost: node.endpointHost,
            wgPort: node.wgPort,
            serverPublicKey: node.serverPublicKey,
          },
          peer: activePeerForDevice,
          clientConfig: buildWgClientConfig({
            clientPrivateKey: (activePeerForDevice as any).privateKey,
            clientAddress: `${activePeerForDevice.allowedIp}/32`,
            serverPublicKey: node.serverPublicKey,
            endpointHost: node.endpointHost,
            wgPort: node.wgPort,
          }),
        });
      }
// deviceLimit enforcement: count distinct deviceIds with active peers
    const activePeers = await prisma.peer.findMany({
      where: { userId: device.userId, nodeId: node.id, revokedAt: null } as any,
      select: { deviceId: true },
    });
    const activeDeviceCount = new Set(activePeers.map((p) => p.deviceId)).size;
    if (activeDeviceCount >= deviceLimit) {
      return reply.code(409).send({
        error: "DEVICE_LIMIT_REACHED",
        deviceLimit,
        activeDeviceCount,
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
        publicKey: clientPublicKey,
          privateKey: clientPrivateKey ?? "",
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
      // rollback DB so this peer doesn't block future provision calls
      await prisma.peer.update({
        where: { id: peer.id } as any,
        data: { revokedAt: new Date() },
      });

      req.log?.error({ err: e }, "wgAddPeer failed");
      return reply.code(502).send({ error: "WG_ADD_FAILED" });
    }

    return reply.code(201).send({
        node: {
        id: node.id,
        endpointHost: node.endpointHost,
        wgPort: node.wgPort,
        serverPublicKey: node.serverPublicKey,
      },
        peer,
        clientConfig: buildWgClientConfig({
          clientPrivateKey: (peer as any).privateKey,
          clientAddress: `${peer.allowedIp}/32`,
          serverPublicKey: node.serverPublicKey,
          endpointHost: node.endpointHost,
          wgPort: node.wgPort,
        }),
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

    return reply.code(200).send({ revoked: true, peerId: active.id });
  });
}
