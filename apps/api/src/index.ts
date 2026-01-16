import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";

import authPlugin from "./plugins/auth";
import { registerAuthRoutes } from "./routes/auth";
import { registerVpnRoutes } from "./routes/vpn";
import { env } from "./env";

async function main() {
  const app = Fastify({ logger: true });

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

  const port = Number(env.PORT || 3001);
  const host = "0.0.0.0";
  await app.listen({ port, host });
}

main().catch((e) => {
  // чтобы в dev было видно фатал
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
