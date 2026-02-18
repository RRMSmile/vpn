import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  DeviceFlowError,
  ensureUser,
  provisionDevicePeer,
  revokeDevicePeer,
} from "../lib/device-flow";
import { normalizePublicKey, WG_PUBLIC_KEY_RE } from "../lib/wg-keys";

const TokenParamSchema = z.object({
  token: z.string().min(1),
});

const ConnectProvisionSchema = z.object({
  publicKey: z
    .string()
    .transform((value) => normalizePublicKey(value))
    .refine((value) => WG_PUBLIC_KEY_RE.test(value), { message: "invalid_wireguard_public_key" }),
});

function replyWithDeviceFlowError(reply: any, error: unknown) {
  if (error instanceof DeviceFlowError) {
    return reply.code(error.statusCode).send({ error: error.code });
  }
  throw error;
}

async function getConnectTokenOrThrow(token: string) {
  const record = await prisma.connectToken.findUnique({ where: { token } });
  if (!record) throw new DeviceFlowError(404, "connect_token_not_found");
  return record;
}

function assertProvisionableToken(record: { expiresAt: Date; usedAt: Date | null }) {
  const now = new Date();
  if (record.expiresAt <= now) throw new DeviceFlowError(410, "connect_token_expired");
  if (record.usedAt) throw new DeviceFlowError(409, "connect_token_used");
}

async function ensureTokenDevice(record: { userId: string; deviceId: string }) {
  await ensureUser(prisma, record.userId);

  const existing = await prisma.device.findFirst({
    where: { userId: record.userId, deviceId: record.deviceId },
    orderBy: { createdAt: "desc" } as any,
  });

  if (existing) return existing;

  return prisma.device.create({
    data: {
      userId: record.userId,
      deviceId: record.deviceId,
      platform: "IOS",
      name: `ios-${record.deviceId.slice(0, 8)}`,
    } as any,
  });
}

export async function registerConnectRoutes(app: FastifyInstance) {
  // POST /v1/connect/:token/provision
  app.post("/v1/connect/:token/provision", async (req: any, reply) => {
    const { token } = TokenParamSchema.parse(req.params ?? {});
    const body = ConnectProvisionSchema.parse(req.body ?? {});

    try {
      const connectToken = await getConnectTokenOrThrow(token);
      assertProvisionableToken(connectToken);

      const device = await ensureTokenDevice(connectToken);
      const result = await provisionDevicePeer(prisma, {
        deviceIdentifier: device.id,
        publicKey: body.publicKey,
        logger: req.log,
      });

      await prisma.connectToken.update({
        where: { token },
        data: { usedAt: new Date() },
      });

      return reply.code(result.statusCode).send({
        peerId: result.peerId,
        allowedIp: result.allowedIp,
        dns: result.dns,
        serverPublicKey: result.serverPublicKey,
        endpointHost: result.endpointHost,
        endpointPort: result.endpointPort,
        persistentKeepalive: result.persistentKeepalive,
        config: result.clientConfig,
        existing: result.existing,
      });
    } catch (error) {
      return replyWithDeviceFlowError(reply, error);
    }
  });

  // GET /v1/connect/:token/status
  app.get("/v1/connect/:token/status", async (req: any, reply) => {
    const { token } = TokenParamSchema.parse(req.params ?? {});

    const connectToken = await prisma.connectToken.findUnique({ where: { token } });
    if (!connectToken) return reply.code(404).send({ error: "connect_token_not_found" });

    const device = await prisma.device.findFirst({
      where: { userId: connectToken.userId, deviceId: connectToken.deviceId },
      orderBy: { createdAt: "desc" } as any,
    });

    const activePeer = device
      ? await prisma.peer.findFirst({
          where: { deviceId: device.id, revokedAt: null },
          orderBy: { createdAt: "desc" } as any,
        })
      : null;

    const now = new Date();
    const status =
      connectToken.expiresAt <= now ? "expired" : connectToken.usedAt ? "used" : "ready";

    return reply.code(200).send({
      token: {
        value: connectToken.token,
        status,
        expiresAt: connectToken.expiresAt,
        usedAt: connectToken.usedAt,
        createdAt: connectToken.createdAt,
        userId: connectToken.userId,
        deviceId: connectToken.deviceId,
      },
      hasActivePeer: Boolean(activePeer),
      activePeer: activePeer
        ? {
            id: activePeer.id,
            allowedIp: activePeer.allowedIp,
            createdAt: activePeer.createdAt,
          }
        : null,
    });
  });

  // POST /v1/connect/:token/revoke
  app.post("/v1/connect/:token/revoke", async (req: any, reply) => {
    const { token } = TokenParamSchema.parse(req.params ?? {});

    try {
      const connectToken = await getConnectTokenOrThrow(token);
      const device = await prisma.device.findFirst({
        where: { userId: connectToken.userId, deviceId: connectToken.deviceId },
        orderBy: { createdAt: "desc" } as any,
      });

      if (!device) {
        return reply.code(200).send({ revoked: false, reason: "device_not_found" });
      }

      const result = await revokeDevicePeer(prisma, {
        deviceIdentifier: device.id,
        logger: req.log,
      });

      return reply.code(result.statusCode).send({
        revoked: result.revoked,
        peerId: result.peerId,
        deviceId: result.deviceId,
        nodeId: result.nodeId,
      });
    } catch (error) {
      return replyWithDeviceFlowError(reply, error);
    }
  });
}
