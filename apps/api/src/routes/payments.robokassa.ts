import { FastifyPluginAsync } from "fastify";
import { buildPaymentSigBase, buildResultSigBase, formatOutSum, hashHex, normSig, pickShpParams, RoboHashAlg } from "../lib/robokassa";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function alg(): RoboHashAlg {
  const v = (process.env.ROBOKASSA_HASH ?? "MD5").toUpperCase();
  return v === "SHA256" ? "SHA256" : "MD5";
}

function isTest(): boolean {
  const v = (process.env.ROBOKASSA_IS_TEST ?? "1").trim().toLowerCase();
  return v === "1" || v === "true";
}

export const paymentsRobokassaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/v1/payments/robokassa/create", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const userId = String(body.userId ?? "");
    const planCode = String(body.planCode ?? "");
    if (!userId || !planCode) return reply.code(400).send({ error: "BAD_REQUEST", message: "userId, planCode required" });

    const plan = await fastify.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) return reply.code(404).send({ error: "PLAN_NOT_FOUND" });

    const pay = await fastify.prisma.payment.create({
      data: { provider: "ROBOKASSA", status: "PENDING", userId, planId: plan.id, amountKopeks: plan.priceKopeks },
    });

    const merchantLogin = mustEnv("ROBOKASSA_MERCHANT_LOGIN");
    const pass1 = mustEnv("ROBOKASSA_PASSWORD1");
    const test = isTest();

    const outSum = formatOutSum(plan.priceKopeks, test);
    const invId = String(pay.invId);

    const shp: Array<[string, string]> = [
      ["Shp_userId", userId],
      ["Shp_plan", plan.code],
    ];

    const sigBase = buildPaymentSigBase({ merchantLogin, outSum, invId, password1: pass1, shp });
    const signatureValue = hashHex(sigBase, alg());

    const params = new URLSearchParams();
    params.set("MerchantLogin", merchantLogin);
    params.set("OutSum", outSum);
    params.set("InvId", invId);
    params.set("Description", `CloudGate VPN: ${plan.title}`);
    params.set("SignatureValue", signatureValue);
    params.set("Encoding", "utf-8");
    params.set("Culture", "ru");
    if (test) params.set("IsTest", "1");
    for (const [k, v] of shp) params.set(k, v);

    const payUrl = `https://auth.robokassa.ru/Merchant/Index.aspx?${params.toString()}`;
    return { invId, payUrl };
  });

  // ResultURL handler
  fastify.post("/v1/payments/robokassa/result", async (req, reply) => {
    const q = (req.query ?? {}) as any;
    const b = (req.body ?? {}) as any;
    const p: Record<string, unknown> = { ...q, ...b };

    const outSum = String(p.OutSum ?? "");
    const invId = String(p.InvId ?? "");
    const sig = String(p.SignatureValue ?? "");
    if (!outSum || !invId || !sig) return reply.code(400).send("bad request");

    const pass2 = mustEnv("ROBOKASSA_PASSWORD2");

    const shp = pickShpParams(p);
    const base = buildResultSigBase({ outSum, invId, password2: pass2, shp });
    const expected = hashHex(base, alg());

    if (normSig(expected) !== normSig(sig)) return reply.code(400).send("bad sign");

    const payment = await fastify.prisma.payment.findUnique({
      where: { invId: BigInt(invId) },
      include: { plan: true },
    });
    if (!payment) return reply.code(404).send("payment_not_found");

    // amount check
    const expectedOutSum = formatOutSum(payment.amountKopeks, isTest());
    if (String(expectedOutSum) !== String(outSum)) {
      await fastify.prisma.payment.update({
        where: { invId: BigInt(invId) },
        data: { rawPayload: (p as any), outSumRaw: outSum, status: "FAILED" },
      });
      return reply.code(400).send("bad amount");
    }

    // idempotent: if already PAID, just OK
    if (payment.status === "PAID") {
      return reply.type("text/plain").send(`OK${invId}`);
    }

    await fastify.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { invId: BigInt(invId) },
        data: {
          status: "PAID",
          paidAt: new Date(),
          rawPayload: (p as any),
          outSumRaw: outSum,
        },
      });

      const now = new Date();
      const plan = payment.plan;
      const activeUntil = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

      await tx.subscription.upsert({
        where: { userId: payment.userId },
        update: { planId: plan.id, status: "ACTIVE", activeFrom: now, activeUntil, deviceLimit: plan.deviceLimit },
        create: { userId: payment.userId, planId: plan.id, status: "ACTIVE", activeFrom: now, activeUntil, deviceLimit: plan.deviceLimit },
      });
    });

    return reply.type("text/plain").send(`OK${invId}`);
  });
};
