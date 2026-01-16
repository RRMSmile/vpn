import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProvisionInputSchema, provisionIosPeer, revokePeer } from "../lib/vpn-provision";

async function requireAuth(req: any) {
  await req.jwtVerify();
}

export async function registerVpnRoutes(app: FastifyInstance) {
  app.post(
    "/vpn/ios/provision",
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const userId = req.user?.sub ?? req.user?.id;
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

  app.post(
    "/vpn/peer/:peerId/revoke",
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const userId = req.user?.sub ?? req.user?.id;
      if (!userId) return reply.code(401).send({ error: "unauthorized" });

      const peerId = z.string().min(1).parse(req.params.peerId);
      const res = await revokePeer(userId, peerId);
      return res;
    }
  );
}
