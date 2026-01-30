import {  } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { allocateAllowedIp } from "./ipAllocator";
import { WG_PUBLIC_KEY_RE, normalizePublicKey } from "./wgPublicKey";
import { randomUUID } from "crypto";

const Env = z.object({
  WG_NODE_ID: z.string().default("wg-node-1"),
  WG_POOL_START: z.string().default("10.8.0.2"),
  WG_POOL_END: z.string().default("10.8.0.254"),

  // node fields (если у тебя в модели иначе - tsc покажет, поправим)
  WG_ENDPOINT_HOST: z.string().optional(),
  WG_PORT: z.coerce.number().default(51820),
  WG_NODE_SSH_HOST: z.string().optional(),
  WG_NODE_SSH_USER: z.string().optional(),
  WG_INTERFACE: z.string().default("wg0"),
  WG_SERVER_PUBLIC_KEY: z.string().optional(),
}).passthrough();

function getEnv() {
  return Env.parse(process.env);
}

export const ProvisionInputSchema = z.object({ publicKey: z.string() });


const PublicKeySchema = z
  .string()
  .transform(normalizePublicKey)
  .refine((v) => WG_PUBLIC_KEY_RE.test(v), {
    message: "Invalid WireGuard publicKey (expected base64 44 chars ending with '=')",
  });

export type ProvisionResult = {
  status: number;
  existing: boolean;
  peer: { id: string; publicKey: string; allowedIp: string; revokedAt: Date | null };
  node: { id: string; endpointHost: string; wgPort: number; serverPublicKey: string | null };
};

export async function provision(
  prisma: PrismaClient,
  args: { deviceId: string; publicKey: string }
): Promise<ProvisionResult> {
  const env = getEnv();
  const publicKey = PublicKeySchema.parse(args.publicKey);

  // deviceId может быть как internal id, так и внешний deviceId — берём по findFirst (совместимо)
  const device = await prisma.device.findFirst({
    where: { OR: [{ id: args.deviceId }, { deviceId: args.deviceId }] },
  });
  if (!device) {
    const e: any = new Error("DEVICE_NOT_FOUND");
    e.status = 404;
    throw e;
  }

  // гарантируем 1 каноничный nodeId через upsert
  const node = await prisma.node.upsert({
    where: { id: env.WG_NODE_ID },
    update: {
      endpointHost: env.WG_ENDPOINT_HOST ?? undefined,
      wgPort: env.WG_PORT,
      sshHost: env.WG_NODE_SSH_HOST ?? undefined,
      sshUser: env.WG_NODE_SSH_USER ?? undefined,
      wgInterface: env.WG_INTERFACE,
      serverPublicKey: env.WG_SERVER_PUBLIC_KEY ?? undefined,
    },
    create: {
      id: env.WG_NODE_ID,
      name: env.WG_NODE_ID,
      endpointHost: env.WG_ENDPOINT_HOST ?? "127.0.0.1",
      wgPort: env.WG_PORT,
      sshHost: env.WG_NODE_SSH_HOST ?? "127.0.0.1",
      sshUser: env.WG_NODE_SSH_USER ?? "root",
      wgInterface: env.WG_INTERFACE,
      serverPublicKey: env.WG_SERVER_PUBLIC_KEY ?? undefined,
    },
  });

  // ключевой фикс: ищем peer по (nodeId, publicKey) без фильтра revokedAt
  const existing = await prisma.peer.findFirst({
    where: { nodeId: node.id, publicKey },
  });

  if (existing) {
    if (existing.deviceId !== device.id) {
      const e: any = new Error("PUBLIC_KEY_IN_USE");
      e.status = 409;
      throw e;
    }

    const updated = await prisma.peer.update({
      where: { id: existing.id },
      data: { revokedAt: null, userId: device.userId },
    });

    return {
      status: 200,
      existing: true,
      peer: {
        id: updated.id,
        publicKey: updated.publicKey,
        allowedIp: updated.allowedIp,
        revokedAt: updated.revokedAt,
      },
      node: {
        id: node.id,
        endpointHost: node.endpointHost,
        wgPort: node.wgPort,
        serverPublicKey: node.serverPublicKey ?? null,
      },
    };
  }

  const allowedIp = await allocateAllowedIp(prisma, {
    nodeId: node.id,
    start: env.WG_POOL_START,
    end: env.WG_POOL_END,
  });

  const created = await prisma.peer.create({
    data: {
      nodeId: node.id,
      deviceId: device.id,
      userId: device.userId,
      publicKey,
      allowedIp,
    },
  });

  return {
    status: 201,
    existing: false,
    peer: {
      id: created.id,
      publicKey: created.publicKey,
      allowedIp: created.allowedIp,
      revokedAt: created.revokedAt,
    },
    node: {
      id: node.id,
      endpointHost: node.endpointHost,
      wgPort: node.wgPort,
      serverPublicKey: node.serverPublicKey ?? null,
    },
  };
}

export async function revoke(
  prisma: PrismaClient,
  args: { deviceId: string }
): Promise<{ status: number; revoked: boolean }> {
  const env = getEnv();

  const device = await prisma.device.findFirst({
    where: { OR: [{ id: args.deviceId }, { deviceId: args.deviceId }] },
  });
  if (!device) {
    const e: any = new Error("DEVICE_NOT_FOUND");
    e.status = 404;
    throw e;
  }

  const active = await prisma.peer.findFirst({
    where: { nodeId: env.WG_NODE_ID, deviceId: device.id, revokedAt: null },
    orderBy: { createdAt: "desc" as any },
  });

  if (!active) return { status: 200, revoked: false };

  await prisma.peer.update({
    where: { id: active.id },
    data: { revokedAt: new Date() },
  });

  return { status: 200, revoked: true };
}

/**
 * Aliases to maximize compatibility with existing imports.
 */
export const vpnProvision = provision;
export const vpnRevoke = revoke;

// Back-compat for existing route imports

// Back-compat wrappers for route layer
// Route-level identity is userId; internal provision/revoke are deviceId-based.

export async function provisionIosPeer(
  prisma: PrismaClient,
  input: { userId: string; publicKey: string }
) {
  const { userId, publicKey } = input;

  // Find or create a canonical iOS device for this user
  let device = await prisma.device.findFirst({
    where: { userId, platform: "IOS" },
  });

  if (!device) {
    device = await prisma.device.create({
      data: { deviceId: randomUUID(), userId, platform: "IOS", name: "iphone" },
    });
  }

  return provision(prisma, { deviceId: device.id, publicKey });
}

export async function provisionConnectLinkPeer(
  prisma: PrismaClient,
  input: {
    userId: string;
    platform: string;
    deviceName: string;
    publicKey: string;
  }
) {
  const { userId, platform, deviceName, publicKey } = input;

  // Create or find guest user for this connect-link token
  // userId format: "connect:abc123..." → email: "connect:abc123...@cloudgate.local"
  const email = `${userId}@cloudgate.local`;
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, role: "guest" },
    update: {},
  });

  // Find or create device for this connect-link user
  let device = await prisma.device.findFirst({
    where: { userId: user.id, platform },
  });

  if (!device) {
    device = await prisma.device.create({
      data: {
        deviceId: randomUUID(),
        userId: user.id,
        platform,
        name: deviceName,
      },
    });
  }

  return provision(prisma, { deviceId: device.id, publicKey });
}

export async function revokePeer(
  prisma: PrismaClient,
  input: { userId: string; peerId: string }
) {
  const { userId, peerId } = input;

  const peer = await prisma.peer.findFirst({
    where: { id: peerId, userId },
    select: { deviceId: true },
  });

  if (!peer) {
    const err: any = new Error("peer_not_found");
    err.code = "PEER_NOT_FOUND";
    throw err;
  }

  return revoke(prisma, { deviceId: peer.deviceId });
}

export default { provision, revoke };
