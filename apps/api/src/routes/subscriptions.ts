import { FastifyPluginAsync } from "fastify";

export const subscriptionsRoutes: FastifyPluginAsync = async (fastify) => {
  // MVP read: пока по query userId (позже заменим на jwt)
  fastify.get("/v1/subscriptions/me", async (req, reply) => {
    const q = (req.query ?? {}) as any;
    const userId = String(q.userId ?? "");
    if (!userId) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "userId required" });
    }

    const sub = await fastify.prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    });

    return { subscription: sub };
  });

  // manual activation (dev/admin hook)
  fastify.post("/v1/subscriptions/activate", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const userId = String(body.userId ?? "");
    const planCode = String(body.planCode ?? "");
    if (!userId || !planCode) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "userId, planCode required" });
    }

    const plan = await fastify.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) {
      return reply.code(404).send({ error: "PLAN_NOT_FOUND" });
    }

    const now = new Date();
    const activeUntil = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    const sub = await fastify.prisma.subscription.upsert({
      where: { userId },
      update: { planId: plan.id, status: "ACTIVE", activeFrom: now, activeUntil, deviceLimit: plan.deviceLimit },
      create: { userId, planId: plan.id, status: "ACTIVE", activeFrom: now, activeUntil, deviceLimit: plan.deviceLimit },
    });

    return { subscription: sub };
  });
};
