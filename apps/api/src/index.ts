import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";

import authPlugin from "./plugins/auth";
import prismaPlugin from "./plugins/prisma";
import { registerAuthRoutes } from "./routes/auth";
import { registerVpnRoutes } from "./routes/vpn";
import { registerDeviceRoutes } from "./routes/devices";
import { env } from "./env";

import formbody from "@fastify/formbody";

import { plansRoutes } from "./routes/plans";

import { subscriptionsRoutes } from "./routes/subscriptions";

import { paymentsRobokassaRoutes } from "./routes/payments.robokassa";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(prismaPlugin);
  await app.register(formbody);
  await app.register(cors, {
    origin: ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type"],
  });

  await app.register(cookie, { secret: env.COOKIE_SECRET });

  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: "cg_session", signed: false },
  });

  await app.register(authPlugin);

  app.get("/health", async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerVpnRoutes(app);

  await registerDeviceRoutes(app);
  const port = Number(env.PORT || 3001);
  const host = "0.0.0.0";
  await app.register(plansRoutes);
  await app.register(subscriptionsRoutes);
  await app.register(paymentsRobokassaRoutes);

  await app.listen({ port, host });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
