import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  DeviceFlowError,
  ensureUser,
  provisionDevicePeer,
  revokeDevicePeer,
} from "../lib/device-flow";
import { normalizePublicKey, WG_PUBLIC_KEY_RE } from "../lib/wg-keys";

const CreateDeviceSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  name: z.string().min(1),
});

const ProvisionSchema = z.object({
  publicKey: z
    .string()
    .transform((value) => normalizePublicKey(value))
    .refine((value) => WG_PUBLIC_KEY_RE.test(value), { message: "invalid_wireguard_public_key" })
    .optional(),
});

function replyWithDeviceFlowError(reply: any, error: unknown) {
  if (error instanceof DeviceFlowError) {
    return reply.code(error.statusCode).send({ error: error.code });
  }
  throw error;
}

export async function registerDeviceRoutes(app: FastifyInstance) {
  // POST /v1/devices (idempotent by userId+platform+name)
  app.post("/v1/devices", async (req: any, reply) => {
    const body = CreateDeviceSchema.parse(req.body);
    await ensureUser(prisma, body.userId);

    const existing = await prisma.device.findFirst({
      where: { userId: body.userId, platform: body.platform, name: body.name },
      select: { id: true, deviceId: true },
    });

    if (existing) {
      return reply.code(200).send({ id: existing.id, deviceId: existing.deviceId, existing: true });
    }

    const created = await prisma.device.create({
      data: {
        deviceId: randomUUID(),
        userId: body.userId,
        platform: body.platform,
        name: body.name,
      } as any,
      select: { id: true, deviceId: true },
    });

    return reply.code(201).send({ id: created.id, deviceId: created.deviceId, existing: false });
  });

  // GET /v1/devices/by-device-id/:deviceId
  app.get("/v1/devices/by-device-id/:deviceId", async (req: any, reply) => {
    const deviceId = z.string().min(1).parse((req.params as any).deviceId);

    const device = await prisma.device.findFirst({
      where: { deviceId } as any,
      orderBy: { createdAt: "desc" } as any,
    });

    if (!device) return reply.code(404).send({ error: "device_not_found" });
    return device;
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
    const body = ProvisionSchema.parse(req.body ?? {});

    try {
      const result = await provisionDevicePeer(prisma, {
        deviceIdentifier: id,
        publicKey: body.publicKey,
        logger: req.log,
      });

      return reply.code(result.statusCode).send({
        existing: result.existing,
        peerId: result.peerId,
        allowedIp: result.allowedIp,
        nodeId: result.nodeId,
        endpoint: result.endpoint,
        serverPublicKey: result.serverPublicKey,
        clientConfig: result.clientConfig,
      });
    } catch (error) {
      return replyWithDeviceFlowError(reply, error);
    }
  });

  // POST /v1/devices/:id/revoke
  app.post("/v1/devices/:id/revoke", async (req: any, reply) => {
    const id = z.string().min(1).parse((req.params as any).id);

    try {
      const result = await revokeDevicePeer(prisma, {
        deviceIdentifier: id,
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
