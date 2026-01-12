import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (req: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    user?: { id: string; email: string; role: string };
  }
}

export default fp(async function authPlugin(app) {
  app.decorate("requireAuth", async (req: any, reply: any) => {
    try {
      // jwtVerify() сам прочитает cookie cg_session (см. конфиг jwt в index.ts) :contentReference[oaicite:3]{index=3}
      const payload: any = await req.jwtVerify();
      req.user = payload.user;
    } catch (err: any) {
      req.log?.warn({ err: String(err?.message || err) }, "auth failed");
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }
  });
});