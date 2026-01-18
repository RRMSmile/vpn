import fp from "fastify-plugin";

export default fp(async (app) => {
  app.decorate("requireAuth", async (req: any) => {
    await req.jwtVerify();
  });
});
