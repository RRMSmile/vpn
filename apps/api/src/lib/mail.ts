import nodemailer from "nodemailer";

export async function sendMagicLink(email: string, url: string) {
  const host = process.env.SMTP_HOST || "mailhog";
  const port = Number(process.env.SMTP_PORT || 1025);
  const secure = String(process.env.SMTP_SECURE || "false") === "true";

  const user = process.env.SMTP_USER || undefined;
  const pass = process.env.SMTP_PASS || undefined;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined
  });

  const from = process.env.EMAIL_FROM || "CloudGate <no-reply@cloudgate.local>";

  await transporter.sendMail({
    from,
    to: email,
    subject: "CloudGate: ссылка для входа",
    text: `Вход в CloudGate:\n${url}\n\nЕсли вы не запрашивали вход, просто игнорируйте письмо.`,
  });
}