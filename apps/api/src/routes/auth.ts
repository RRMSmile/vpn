import { AuthConsumeSchema, AuthRequestSchema } from "@cloudgate/shared/src/schemas";
import { prisma } from "../lib/prisma";
import { genToken, sha256 } from "../lib/tokens";
import { sendMagicLink } from "../lib/mail";
import { env } from "../env";

export async function registerAuthRoutes(app: any) {
  app.post("/auth/request", async (req: any, reply: any) => {
    const body = AuthRequestSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const token = genToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.magicToken.create({
      data: { tokenHash, email, expiresAt },
    });

    const publicWeb = process.env.PUBLIC_WEB_URL || "http://localhost:3000";
    const url = `${publicWeb}/auth/callback?token=${encodeURIComponent(token)}`;

    await sendMagicLink(email, url);

    // В DEV мы возвращаем токен прямо в ответ, чтобы не копировать из логов
    if (env.MAIL_DEV_LOG_ONLY) {
      return reply.send({ ok: true, devToken: token, devUrl: url });
    }

    return reply.send({ ok: true });
  });

  app.post("/auth/consume", async (req: any, reply: any) => {
    const body = AuthConsumeSchema.parse(req.body);
    const tokenHash = sha256(body.token);

    const mt = await prisma.magicToken.findUnique({ where: { tokenHash } });
    if (!mt) return reply.code(400).send({ ok: false, error: "invalid_token" });
    if (mt.usedAt) return reply.code(400).send({ ok: false, error: "token_used" });
    if (mt.expiresAt.getTime() < Date.now()) return reply.code(400).send({ ok: false, error: "token_expired" });

    await prisma.magicToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    });

    const user = await prisma.user.upsert({
      where: { email: mt.email },
      update: {},
      create: { email: mt.email, role: "user" },
    });

    const jwtPayload = { user: { id: user.id, email: user.email, role: user.role } };

    const session = await reply.jwtSign(jwtPayload, { expiresIn: "30d" });

    reply.setCookie("cg_session", session, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });

    return reply.send({ ok: true, user: jwtPayload.user });
  });

  app.get("/me", { preHandler: app.requireAuth }, async (req: any, reply: any) => {
    return reply.send({ ok: true, user: (req as any).user?.user ?? (req as any).user });
  });

  app.post("/auth/logout", async (_req: any, reply: any) => {
    reply.clearCookie("cg_session", { path: "/" });
    return reply.send({ ok: true });
  });
}
