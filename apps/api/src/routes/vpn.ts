import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProvisionInputSchema, provisionIosPeer, revokePeer } from "../lib/vpn-provision";
import { renderClientConfig } from "../lib/wg-config";
import { prisma } from "../lib/prisma";
import { env } from "../env";

async function requireAuth(req: any) {
  await req.jwtVerify();
}

function getUserId(req: any): string | null {
  return req.user?.sub ?? req.user?.id ?? req.user?.user?.id ?? null;
}

function buildConfigTemplate(params: {
  addressIp: string; // "10.8.0.10"
  dns: string;
  serverPublicKey: string;
  endpointHost: string;
  endpointPort: number;
}) {
  const { addressIp, dns, serverPublicKey, endpointHost, endpointPort } = params;

  return [
    `[Interface]`,
    `PrivateKey = {{CLIENT_PRIVATE_KEY}}`,
    `Address = ${addressIp}/32`,
    `DNS = ${dns}`,
    ``,
    `[Peer]`,
    `PublicKey = ${serverPublicKey}`,
    `Endpoint = ${endpointHost}:${endpointPort}`,
    `AllowedIPs = 0.0.0.0/0`,
    `PersistentKeepalive = 25`,
    ``,
  ].join("\n");
}

function safeFilename(s: string) {
  // максимально безопасно для Content-Disposition
  const cleaned = (s || "device")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "device";
}

export async function registerVpnRoutes(app: FastifyInstance) {
  // iOS provision (создать/вернуть peer)
  app.post(
    "/vpn/ios/provision",
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const userId = getUserId(req);
      if (!userId) return reply.code(401).send({ error: "unauthorized" });

      const body = ProvisionInputSchema.parse(req.body);
      const result = await provisionIosPeer(userId, body);

      return {
        peerId: result.peer.id,
        allowedIp: result.peer.allowedIp,
        configTemplate: result.configTemplate,
      };
    }
  );

  // revoke peer
  app.post(
    "/vpn/peer/:peerId/revoke",
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const userId = getUserId(req);
      if (!userId) return reply.code(401).send({ error: "unauthorized" });

      const peerId = z.string().min(1).parse((req.params as any).peerId);
      const res = await revokePeer(userId, peerId);
      return res;
    }
  );

  // download config as text/plain
  // optional: ?clientPrivateKey=... (НЕ хранится, просто подставим в шаблон)
  app.get(
    "/vpn/peer/:peerId/config",
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const userId = getUserId(req);
      if (!userId) return reply.code(401).send({ error: "unauthorized" });

      const peerId = z.string().min(1).parse((req.params as any).peerId);

      const peer = await prisma.peer.findFirst({
        where: { id: peerId, userId },
        include: { node: true, device: true },
      });

      if (!peer) return reply.code(404).send({ error: "peer_not_found" });

      // можно запретить выдачу для revoked, но для дебага иногда полезно
      // if (peer.revokedAt) return reply.code(410).send({ error: "peer_revoked" });

      const template = buildConfigTemplate({
        addressIp: peer.allowedIp,
        dns: env.WG_CLIENT_DNS,
        serverPublicKey: peer.node.serverPublicKey,
        endpointHost: peer.node.endpointHost,
        endpointPort: peer.node.wgPort,
      });

      const q = (req.query ?? {}) as any;
      const clientPrivateKey =
        typeof q.clientPrivateKey === "string" ? q.clientPrivateKey : undefined;

      const cfg = renderClientConfig({ template, clientPrivateKey });

      const fnameBase = safeFilename(peer.device?.deviceId || peer.deviceId || "device");
      const filename = `cloudgate-${fnameBase}.conf`;

      reply.header("content-type", "text/plain; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      return reply.send(cfg);
    }
  );
}
