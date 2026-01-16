import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";

import authPlugin from "./plugins/auth";
import { registerAuthRoutes } from "./routes/auth";

import { registerVpnRoutes } from "./routes/vpn";
async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type"]
  });

  // ВАЖНО: cookie должен быть зарегистрирован, чтобы jwt мог читать токен из req.cookies :contentReference[oaicite:1]{index=1}
  await app.register(cookie, { secret: process.env.COOKIE_SECRET });

  // Включаем cookie-режим у jwt: jwtVerify() будет брать токен из cookie cg_session :contentReference[oaicite:2]{index=2}
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET,
    cookie: { cookieName: "cg_session", signed: false }
  });

  await app.register(authPlugin);

  app.get("/health", async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerVpnRoutes(app);
  const port = Number(process.env.PORT || 3001);
  const host = "0.0.0.0";

  await app.listen({ port, host });
}

main();