import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.string().optional(),

  JWT_SECRET: z.string().min(10),
  COOKIE_SECRET: z.string().min(10),

  WG_NODE_SSH_HOST: z.string().min(3),
  WG_NODE_SSH_USER: z.string().min(1),
  WG_NODE_SSH_OPTS: z.string().optional().default(""),

  WG_INTERFACE: z.string().default("wg0"),
  WG_SERVER_PORT: z.coerce.number().int().positive().default(51820),

  WG_POOL_START: z.string().min(7),
  WG_POOL_END: z.string().min(7),
  WG_CLIENT_DNS: z.string().min(3).default("1.1.1.1"),

  WG_SERVER_PUBLIC_KEY: z.string().min(20),
});

export const env = EnvSchema.parse(process.env);
