import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProvisionInputSchema, provisionIosPeer, revokePeer } from "../lib/vpn-provision";
import { renderClientConfig } from "../lib/wg-config";

async function requireAuth(req: any) {
  await req.jwtVerify();
}

function getUserId(req: any): string | null {
  return req.user?.sub ?? req.user?.id ?? req.user?.user?.id ?? null;
}

export async function registerVpnRoutes(app: FastifyInstance) {
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

  app.post(
    "/vpn/peer/:peerId/revoke",
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const userId = getUserId(req);
      if (!userId) return reply.code(401).send({ error: "unauthorized" });

      const peerId = z.string().min(1).parse((req.params as any).peerId);
      return await revokePeer(userId, peerId);
    }
  );
  app.get(
    "/vpn/peer/:peerId/config",
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const userId = getUserId(req);
      if (!userId) return reply.code(401).send({ error: "unauthorized" });

      const peerId = z.string().min(1).parse((req.params as any).peerId);

      // reuse existing logic: revokePeer/provision already know how to build template,
      // but here we read from DB and rebuild minimal template response
      // We'll call /vpn/ios/provision logic indirectly by simply refusing if peer missing.
      // The provisioning function already stores node+peer; we can reconstruct template on the fly in a later pass.
      // For MVP: return template from DB requires we store it, so instead we just return placeholder template from current API contract.
      // NOTE: Full implementation in next patch will rebuild from Node fields.
      return reply.code(501).send({ error: "not_implemented", hint: "Implement config download by rebuilding template from Peer+Node. See TODO." });
    }
  );

}
