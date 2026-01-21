#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
API="$ROOT/apps/api"
SRC="$API/src"
PRISMA="$API/prisma"
SCHEMA="$PRISMA/schema.prisma"

mkdir -p "$SRC/lib" "$SRC/routes" "$PRISMA"

echo "== create files =="

cat > "$SRC/lib/robokassa.ts" <<'TS'
import crypto from "node:crypto";

export type RoboHashAlg = "MD5" | "SHA256";

export function formatOutSum(amountKopeks: number, isTest: boolean): string {
  if (amountKopeks < 0) throw new Error("amountKopeks must be >= 0");
  const rub = Math.floor(amountKopeks / 100);
  const kop = amountKopeks % 100;

  if (isTest) {
    // test: integer (assume kopeks=0)
    if (kop !== 0) throw new Error("Test mode requires whole ruble amounts (kopeks=0)");
    return String(rub);
  }

  // prod: rubles with 6 decimals (kopeks=2 decimals + 4 zeros)
  return `${rub}.${String(kop).padStart(2, "0")}0000`;
}

export function hashHex(input: string, alg: RoboHashAlg): string {
  const a = alg === "SHA256" ? "sha256" : "md5";
  return crypto.createHash(a).update(input, "utf8").digest("hex");
}

export function pickShpParams(params: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("Shp_") || k.startsWith("shp_")) out.push([k, String(v ?? "")]);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

export function buildPaymentSigBase(args: {
  merchantLogin: string;
  outSum: string;
  invId: string;
  password1: string;
  shp?: Array<[string, string]>;
}): string {
  const parts = [args.merchantLogin, args.outSum, args.invId, args.password1];
  for (const [k, v] of args.shp ?? []) parts.push(`${k}=${v}`);
  return parts.join(":");
}

export function buildResultSigBase(args: {
  outSum: string;
  invId: string;
  password2: string;
  shp?: Array<[string, string]>;
}): string {
  const parts = [args.outSum, args.invId, args.password2];
  for (const [k, v] of args.shp ?? []) parts.push(`${k}=${v}`);
  return parts.join(":");
}

export function normSig(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}
TS

cat > "$SRC/lib/subscription.ts" <<'TS'
export type AssertOk = { ok: true; deviceLimit: number };
export type AssertFail = { ok: false; statusCode: number; code: string; message: string; meta?: any };
export type AssertSubscriptionResult = AssertOk | AssertFail;

// prisma typed as any to keep patch portable
export async function assertSubscription(prisma: any, userId: string, deviceId: string): Promise<AssertSubscriptionResult> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });

  if (!sub) {
    return { ok: false, statusCode: 402, code: "subscription_required", message: "No active subscription" };
  }

  const now = new Date();
  if (sub.status !== "ACTIVE" || !(sub.activeUntil instanceof Date) || sub.activeUntil <= now) {
    return { ok: false, statusCode: 402, code: "subscription_inactive", message: "Subscription inactive or expired" };
  }

  const deviceLimit = Number(sub.deviceLimit ?? 1);

  // if this device already active -> allow (idempotent)
  const hasActivePeer = await prisma.peer.findFirst({
    where: { deviceId, revokedAt: null },
    select: { id: true },
  });
  if (hasActivePeer) return { ok: true, deviceLimit };

  // count active peers for user (MVP: 1 peer per device; good enough for now)
  const activePeersCount = await prisma.peer.count({
    where: { revokedAt: null, device: { userId } },
  });

  if (activePeersCount >= deviceLimit) {
    return {
      ok: false,
      statusCode: 409,
      code: "device_limit_reached",
      message: "Device limit reached for this plan",
      meta: { deviceLimit, activePeersCount },
    };
  }

  return { ok: true, deviceLimit };
}
TS

cat > "$SRC/routes/plans.ts" <<'TS'
import { FastifyPluginAsync } from "fastify";

export const plansRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/v1/plans", async () => {
    const plans = await fastify.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceKopeks: "asc" },
      select: { code: true, title: true, priceKopeks: true, durationDays: true, deviceLimit: true, isActive: true },
    });
    return { plans };
  });
};
TS

cat > "$SRC/routes/subscriptions.ts" <<'TS'
import { FastifyPluginAsync } from "fastify";

export const subscriptionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/v1/subscriptions/activate", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const userId = String(body.userId ?? "");
    const planCode = String(body.planCode ?? "");
    if (!userId || !planCode) return reply.code(400).send({ error: "BAD_REQUEST", message: "userId, planCode required" });

    const plan = await fastify.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) return reply.code(404).send({ error: "PLAN_NOT_FOUND" });

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
TS

cat > "$SRC/routes/payments.robokassa.ts" <<'TS'
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
        data: { rawPayload: p, outSumRaw: outSum, status: "FAILED" },
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
          rawPayload: p,
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
TS

echo "== prisma schema patch =="

if ! grep -q "model Plan" "$SCHEMA"; then
  cat >> "$SCHEMA" <<'PRISMA'

enum PaymentProvider {
  ROBOKASSA
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
  CANCELED
}

model Plan {
  id           String   @id @default(cuid())
  code         String   @unique
  title        String
  priceKopeks  Int
  durationDays Int
  deviceLimit  Int
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  subscriptions Subscription[]
  payments      Payment[]
}

model Subscription {
  id         String   @id @default(cuid())
  userId     String   @unique
  planId     String
  status     String
  activeFrom DateTime
  activeUntil DateTime
  deviceLimit Int
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  plan       Plan     @relation(fields: [planId], references: [id])
}

model Payment {
  invId        BigInt   @id @default(autoincrement())
  provider     PaymentProvider
  status       PaymentStatus @default(PENDING)

  userId       String
  planId       String
  amountKopeks Int

  outSumRaw    String?
  paidAt       DateTime?
  rawPayload   Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  plan         Plan     @relation(fields: [planId], references: [id])

  @@index([userId, status])
  @@index([planId])
}
PRISMA
else
  echo "Schema already has Plan - skipping"
fi

echo "== prisma seed =="

cat > "$PRISMA/seed.ts" <<'TS'
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.upsert({
    where: { code: "basic" },
    update: { title: "Basic", priceKopeks: 29900, durationDays: 30, deviceLimit: 1, isActive: true },
    create: { code: "basic", title: "Basic", priceKopeks: 29900, durationDays: 30, deviceLimit: 1, isActive: true },
  });

  await prisma.plan.upsert({
    where: { code: "pro" },
    update: { title: "Pro", priceKopeks: 49900, durationDays: 30, deviceLimit: 3, isActive: true },
    create: { code: "pro", title: "Pro", priceKopeks: 49900, durationDays: 30, deviceLimit: 3, isActive: true },
  });

  console.log("seed ok");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
TS

echo "== ensure seed runner (tsx) =="

( cd "$API" && pnpm add -D tsx >/dev/null )

python3 - <<PY
import json, pathlib
p = pathlib.Path("$API/package.json")
j = json.loads(p.read_text())
j.setdefault("prisma", {})
j["prisma"]["seed"] = "tsx prisma/seed.ts"
p.write_text(json.dumps(j, indent=2) + "\n")
print("package.json patched prisma.seed")
PY

echo "== patch app entrypoint registrations =="

ENTRY="$(grep -R --line-number "devicesRoutes" "$SRC" | head -n1 | cut -d: -f1 || true)"
if [[ -z "$ENTRY" ]]; then
  ENTRY="$(grep -R --line-number "routes/devices" "$SRC" | head -n1 | cut -d: -f1 || true)"
fi
if [[ -z "$ENTRY" ]]; then
  echo "ERROR: cannot find entrypoint that references devices routes"
  exit 2
fi

python3 - <<PY
import re, pathlib
path = pathlib.Path("$ENTRY")
s = path.read_text()

def add_import(line: str):
  global s
  if line in s: return
  m = list(re.finditer(r'^(import .*?;\\s*)$', s, flags=re.M))
  if m:
    i = m[-1].end()
    s = s[:i] + "\\n" + line + "\\n" + s[i:]
  else:
    s = line + "\\n" + s

add_import('import formbody from "@fastify/formbody";')
add_import('import { plansRoutes } from "./routes/plans";')
add_import('import { subscriptionsRoutes } from "./routes/subscriptions";')
add_import('import { paymentsRobokassaRoutes } from "./routes/payments.robokassa";')

if "fastify.register(formbody" not in s:
  block = (
    "  await fastify.register(formbody);\\n"
    "  await fastify.register(plansRoutes);\\n"
    "  await fastify.register(subscriptionsRoutes);\\n"
    "  await fastify.register(paymentsRobokassaRoutes);\\n"
  )
  m = re.search(r'\\n\\s*await\\s+fastify\\.register\\([^\\n]*devices', s)
  if m:
    s = s[:m.start()+1] + block + s[m.start()+1:]
  else:
    m2 = re.search(r'\\n\\s*await\\s+fastify\\.listen\\b', s)
    if m2:
      s = s[:m2.start()+1] + block + s[m2.start()+1:]
    else:
      raise SystemExit("cannot find insertion point for register()")
path.write_text(s)
print("patched entry:", path)
PY

echo "== patch provision with assertSubscription =="

DEVICES="$SRC/routes/devices.ts"
if [[ ! -f "$DEVICES" ]]; then
  echo "ERROR: $DEVICES not found"
  exit 3
fi

python3 - <<'PY'
import re, pathlib
path = pathlib.Path("apps/api/src/routes/devices.ts")
s = path.read_text()

if "assertSubscription" not in s:
  # add import after last import
  m = list(re.finditer(r'^(import .*?;\\s*)$', s, flags=re.M))
  ins = 'import { assertSubscription } from "../lib/subscription";\\n'
  if m:
    i = m[-1].end()
    s = s[:i] + "\\n" + ins + s[i:]
  else:
    s = ins + s

# insert into provision handler only once
if "subscription_required" not in s and "device_limit_reached" not in s:
  idx = s.find("/provision")
  if idx == -1:
    raise SystemExit("Cannot find /provision route in devices.ts")
  m = re.search(r'if\\s*\\(\\s*!device\\s*\\)\\s*\\{[^}]*\\}\\s*', s[idx:], flags=re.S)
  if not m:
    raise SystemExit("Cannot find 'if (!device) { ... }' after /provision")
  at = idx + m.end()
  block = """
    // billing gate: subscription + device limit
    const subCheck = await assertSubscription(fastify.prisma, device.userId, device.id);
    if (!subCheck.ok) {
      return reply.code(subCheck.statusCode).send({ error: subCheck.code, message: subCheck.message, meta: subCheck.meta });
    }

"""
  s = s[:at] + block + s[at:]

path.write_text(s)
print("patched:", path)
PY

echo "== done =="
git -C "$ROOT" diff --stat
