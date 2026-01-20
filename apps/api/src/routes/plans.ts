import { FastifyPluginAsync } from "fastify";

export const plansRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/v1/plans", async () => {
    const plans = await fastify.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceKopeks: "asc" },
    });
    return { items: plans, total: plans.length };
  });
};
