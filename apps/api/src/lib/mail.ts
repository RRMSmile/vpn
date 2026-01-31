import nodemailer from "nodemailer";
import { env } from "../env";

export async function sendMagicLink(to: string, url: string) {
  // DEV-режим: не отправляем письма, просто печатаем ссылку
  if (env.MAIL_DEV_LOG_ONLY) {
    // eslint-disable-next-line no-console
    console.log(`[MAIL_DEV_LOG_ONLY] magic link for ${to}: ${url}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: false,
  });

  try {
    await transporter.sendMail({
      from: env.MAIL_FROM,
      to,
      subject: "CloudGate login link",
      text: `Open: ${url}`,
      html: `<p>Open: <a href="${url}">${url}</a></p>`,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(`[MAIL_FALLBACK] failed to send mail, logging link instead: ${e?.message ?? e}`);
    // eslint-disable-next-line no-console
    console.log(`[MAIL_FALLBACK] magic link for ${to}: ${url}`);
  }
}
