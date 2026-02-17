import type { PrismaClient } from "@prisma/client";
import { env } from "../env";
import { allocateAllowedIp } from "./ipAllocator";
import { generateWgKeypair } from "./wg-keys";
import { wgAddPeer, wgRemovePeer } from "./wg-node";

const DEFAULT_NODE_ID = "wg-node-1";
const DEFAULT_POOL_START = "10.8.0.2";
const DEFAULT_POOL_END = "10.8.0.254";
const PERSISTENT_KEEPALIVE = 25;

export class DeviceFlowError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string) {
    super(code);
    this.name = "DeviceFlowError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isUniqueConstraintFor(err: any, fields: string[]): boolean {
  if (err?.code !== "P2002" || !Array.isArray(err?.meta?.target)) return false;
  return fields.every((f) => err.meta.target.includes(f));
}

function buildWgClientConfig(args: {
  clientPrivateKey: string | null;
  clientAddress: string;
  serverPublicKey: string;
  endpointHost: string;
  endpointPort: number;
  dns: string;
  persistentKeepalive: number;
}) {
  return (
    `[Interface]\n` +
    (args.clientPrivateKey ? `PrivateKey = ${args.clientPrivateKey}\n` : "") +
    `Address = ${args.clientAddress}\n` +
    `DNS = ${args.dns}\n\n` +
    `[Peer]\n` +
    `PublicKey = ${args.serverPublicKey}\n` +
    `AllowedIPs = 0.0.0.0/0, ::/0\n` +
    `Endpoint = ${args.endpointHost}:${args.endpointPort}\n` +
    `PersistentKeepalive = ${args.persistentKeepalive}\n`
  );
}

async function resolveDevice(prisma: PrismaClient, deviceIdentifier: string) {
  return prisma.device.findFirst({
    where: {
      OR: [{ id: deviceIdentifier }, { deviceId: deviceIdentifier }],
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function ensureNode(prisma: PrismaClient) {
  const nodeId = process.env.WG_NODE_ID ?? DEFAULT_NODE_ID;
  const endpointHost =
    process.env.WG_ENDPOINT_HOST ??
    process.env.WG_NODE_ENDPOINT_HOST ??
    env.WG_NODE_SSH_HOST;
  const wgPort = Number(process.env.WG_PORT ?? process.env.WG_NODE_WG_PORT ?? "51820");

  const existing = await prisma.node.findUnique({ where: { id: nodeId } as any });
  if (existing) {
    const updated = await prisma.node.update({
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

    if (!updated.serverPublicKey) throw new DeviceFlowError(500, "NODE_SERVER_PUBLIC_KEY_MISSING");
    return updated;
  }

  const serverPublicKey = env.WG_SERVER_PUBLIC_KEY;
  if (!serverPublicKey) throw new DeviceFlowError(500, "WG_SERVER_PUBLIC_KEY_REQUIRED_FOR_NODE_CREATE");

  const created = await prisma.node.create({
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

  return created;
}

async function reservePeerSlot(
  prisma: PrismaClient,
  args: {
    nodeId: string;
    deviceId: string;
    userId: string;
    publicKey: string;
    privateKey: string;
  }
) {
  const poolStart = process.env.WG_POOL_START ?? DEFAULT_POOL_START;
  const poolEnd = process.env.WG_POOL_END ?? DEFAULT_POOL_END;

  for (let attempt = 1; attempt <= 10; attempt++) {
    const allowedIp = await allocateAllowedIp(prisma, {
      nodeId: args.nodeId,
      start: poolStart,
      end: poolEnd,
    });
    const pendingAt = new Date();

    try {
      return await prisma.peer.create({
        data: {
          nodeId: args.nodeId,
          deviceId: args.deviceId,
          userId: args.userId,
          publicKey: args.publicKey,
          privateKey: args.privateKey,
          allowedIp,
          revokedAt: pendingAt,
        } as any,
      });
    } catch (err: any) {
      if (isUniqueConstraintFor(err, ["nodeId", "publicKey"])) {
        const existingOnKey = await prisma.peer.findFirst({
          where: { nodeId: args.nodeId, publicKey: args.publicKey } as any,
        });

        if (!existingOnKey) continue;
        if (existingOnKey.revokedAt === null) throw new DeviceFlowError(409, "PUBLIC_KEY_IN_USE");

        try {
          return await prisma.peer.update({
            where: { id: existingOnKey.id } as any,
            data: {
              deviceId: args.deviceId,
              userId: args.userId,
              privateKey: args.privateKey,
              revokedAt: pendingAt,
            } as any,
          });
        } catch (reuseByKeyErr: any) {
          if (
            isUniqueConstraintFor(reuseByKeyErr, ["nodeId", "allowedIp"]) ||
            isUniqueConstraintFor(reuseByKeyErr, ["nodeId", "publicKey"])
          ) {
            continue;
          }
          throw reuseByKeyErr;
        }
      }

      if (!isUniqueConstraintFor(err, ["nodeId", "allowedIp"])) throw err;

      const existingOnIp = await prisma.peer.findFirst({
        where: { nodeId: args.nodeId, allowedIp } as any,
      });

      if (!existingOnIp || existingOnIp.revokedAt === null) continue;

      try {
        return await prisma.peer.update({
          where: { id: existingOnIp.id } as any,
          data: {
            deviceId: args.deviceId,
            userId: args.userId,
            publicKey: args.publicKey,
            privateKey: args.privateKey,
            revokedAt: pendingAt,
          } as any,
        });
      } catch (reuseErr: any) {
        if (
          isUniqueConstraintFor(reuseErr, ["nodeId", "allowedIp"]) ||
          isUniqueConstraintFor(reuseErr, ["nodeId", "publicKey"])
        ) {
          continue;
        }
        throw reuseErr;
      }
    }
  }

  throw new DeviceFlowError(500, "PEER_CREATE_CONFLICT_AFTER_RETRIES");
}

export async function ensureUser(prisma: PrismaClient, userId: string) {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: `${userId}@users.cloudgate.local`,
    },
  });
}

export async function provisionDevicePeer(
  prisma: PrismaClient,
  input: { deviceIdentifier: string; publicKey?: string | null; logger?: any }
) {
  const device = await resolveDevice(prisma, input.deviceIdentifier);
  if (!device) throw new DeviceFlowError(404, "device_not_found");

  const node = await ensureNode(prisma);

  const active = await prisma.peer.findFirst({
    where: { deviceId: device.id, nodeId: node.id, revokedAt: null },
    orderBy: { createdAt: "desc" } as any,
  });

  if (active) {
    const clientConfig = buildWgClientConfig({
      clientPrivateKey: input.publicKey ? null : active.privateKey || null,
      clientAddress: `${active.allowedIp}/32`,
      serverPublicKey: node.serverPublicKey,
      endpointHost: node.endpointHost,
      endpointPort: node.wgPort,
      dns: env.WG_CLIENT_DNS,
      persistentKeepalive: PERSISTENT_KEEPALIVE,
    });

    return {
      statusCode: 200 as const,
      existing: true,
      peerId: active.id,
      allowedIp: active.allowedIp,
      nodeId: node.id,
      endpointHost: node.endpointHost,
      endpointPort: node.wgPort,
      endpoint: `${node.endpointHost}:${node.wgPort}`,
      serverPublicKey: node.serverPublicKey,
      dns: env.WG_CLIENT_DNS,
      persistentKeepalive: PERSISTENT_KEEPALIVE,
      clientConfig,
      deviceId: device.id,
    };
  }

  let clientPublicKey = "";
  let clientPrivateKey = "";
  if (typeof input.publicKey === "string" && input.publicKey.trim().length > 0) {
    clientPublicKey = input.publicKey.trim();
    clientPrivateKey = "";
  } else {
    const generated = generateWgKeypair();
    clientPublicKey = generated.publicKey;
    clientPrivateKey = generated.privateKey;
  }

  const pending = await reservePeerSlot(prisma, {
    nodeId: node.id,
    deviceId: device.id,
    userId: device.userId,
    publicKey: clientPublicKey,
    privateKey: clientPrivateKey,
  });

  try {
    await wgAddPeer({
      publicKey: pending.publicKey,
      allowedIp: pending.allowedIp,
      node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },
    });
  } catch (error: any) {
    input.logger?.error?.({ err: error }, "wgAddPeer failed");
    await prisma.peer.update({
      where: { id: pending.id } as any,
      data: { revokedAt: new Date() },
    });
    throw new DeviceFlowError(502, "WG_ADD_FAILED");
  }

  const activated = await prisma.peer.update({
    where: { id: pending.id } as any,
    data: { revokedAt: null },
  });

  const clientConfig = buildWgClientConfig({
    clientPrivateKey: clientPrivateKey || null,
    clientAddress: `${activated.allowedIp}/32`,
    serverPublicKey: node.serverPublicKey,
    endpointHost: node.endpointHost,
    endpointPort: node.wgPort,
    dns: env.WG_CLIENT_DNS,
    persistentKeepalive: PERSISTENT_KEEPALIVE,
  });

  return {
    statusCode: 201 as const,
    existing: false,
    peerId: activated.id,
    allowedIp: activated.allowedIp,
    nodeId: node.id,
    endpointHost: node.endpointHost,
    endpointPort: node.wgPort,
    endpoint: `${node.endpointHost}:${node.wgPort}`,
    serverPublicKey: node.serverPublicKey,
    dns: env.WG_CLIENT_DNS,
    persistentKeepalive: PERSISTENT_KEEPALIVE,
    clientConfig,
    deviceId: device.id,
  };
}

export async function revokeDevicePeer(
  prisma: PrismaClient,
  input: { deviceIdentifier: string; logger?: any }
) {
  const device = await resolveDevice(prisma, input.deviceIdentifier);
  if (!device) throw new DeviceFlowError(404, "device_not_found");

  const node = await ensureNode(prisma);
  const active = await prisma.peer.findFirst({
    where: { deviceId: device.id, nodeId: node.id, revokedAt: null },
    orderBy: { createdAt: "desc" } as any,
  });

  if (!active) {
    return {
      statusCode: 200 as const,
      revoked: false,
      peerId: null,
      deviceId: device.id,
      nodeId: node.id,
    };
  }

  try {
    await wgRemovePeer({
      publicKey: active.publicKey,
      node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },
    });
  } catch (error: any) {
    const message = String(error?.stderr || error?.message || "");
    if (!/no such peer|not found/i.test(message)) {
      input.logger?.error?.({ err: error }, "wgRemovePeer failed");
      throw new DeviceFlowError(502, "WG_REMOVE_FAILED");
    }
    input.logger?.warn?.({ err: error }, "wgRemovePeer failed but ignoring (peer missing)");
  }

  await prisma.peer.update({
    where: { id: active.id } as any,
    data: { revokedAt: new Date() },
  });

  return {
    statusCode: 200 as const,
    revoked: true,
    peerId: active.id,
    deviceId: device.id,
    nodeId: node.id,
  };
}
