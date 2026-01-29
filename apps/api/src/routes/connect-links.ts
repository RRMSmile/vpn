import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { provisionConnectLinkPeer } from "../lib/vpn-provision";
import { WG_PUBLIC_KEY_RE, normalizePublicKey } from "../lib/wgPublicKey";

const CreateSchema = z.object({
  ttlMinutes: z.number().min(1).max(1440).default(60),
});

const ProvisionSchema = z.object({
  publicKey: z
    .string()
    .transform((v) => normalizePublicKey(v))
    .refine((v) => WG_PUBLIC_KEY_RE.test(v), {
      message: "invalid_wireguard_public_key",
    }),
  platform: z.enum(["IOS", "ANDROID"]).default("IOS"),
  deviceName: z.string().min(1).max(100).default("iPhone"),
});

export async function registerConnectLinkRoutes(app: FastifyInstance) {
  app.post("/v1/connect-links", async (req) => {
    const { ttlMinutes } = CreateSchema.parse(req.body ?? {});

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await prisma.connectLink.create({ data: { token, expiresAt } });

    return {
      token,
      expiresAt,
      deepLink: `${process.env.PUBLIC_APP_SCHEME || "safevpn"}://connect/${token}`,
    };
  });

  app.post<{ Params: { token: string } }>("/v1/connect/:token/provision", async (req, reply) => {
    const { token } = req.params;
    const { publicKey, platform, deviceName } = ProvisionSchema.parse(req.body);

    const link = await prisma.connectLink.findUnique({ where: { token } });
    if (!link) return reply.code(404).send({ error: "INVALID_TOKEN" });

    if (link.expiresAt < new Date()) {
      return reply.code(410).send({ error: "TOKEN_EXPIRED" });
    }

    if (link.boundPublicKey && link.boundPublicKey !== publicKey) {
      return reply.code(409).send({ error: "TOKEN_ALREADY_BOUND" });
    }

    if (link.usedAt && link.peerId && link.boundPublicKey === publicKey) {
      // Re-provision: return consistent response format
      const peer = await prisma.peer.findFirst({
        where: { id: link.peerId },
        include: { node: true },
      });

      if (!peer) {
        return reply.code(404).send({ error: "PEER_NOT_FOUND" });
      }

      return {
        existing: true,
        status: 200,
        peer: {
          id: peer.id,
          publicKey: peer.publicKey,
          allowedIp: peer.allowedIp,
          revokedAt: peer.revokedAt,
        },
        node: {
          id: peer.node.id,
          endpointHost: peer.node.endpointHost,
          wgPort: peer.node.wgPort,
          serverPublicKey: peer.node.serverPublicKey,
        },
      };
    }

    const result = await provisionConnectLinkPeer(prisma, {
      userId: `connect:${token}`,
      platform,
      deviceName,
      publicKey,
    });

    await prisma.connectLink.update({
      where: { id: link.id },
      data: {
        usedAt: link.usedAt ?? new Date(),
        boundPublicKey: publicKey,
        peerId: result.peer.id,
      },
    });

    return { existing: false, ...result };
  });
}
