import "dotenv/config";
import { z } from "zod";

const zEnv = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  COOKIE_SECRET: z.string(),
  PUBLIC_WEB_URL: z.string().url(),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  EMAIL_FROM: z.string(),
  ADMIN_EMAILS: z.string().optional().default("")
});

export const env = zEnv.parse(process.env);

export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
);

