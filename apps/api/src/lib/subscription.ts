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
