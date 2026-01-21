import "dotenv/config";
import { Bot, InlineKeyboard, InputFile } from "grammy";

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3001";
const SUPPORT_CHAT_ID = process.env.SUPPORT_CHAT_ID ? Number(process.env.SUPPORT_CHAT_ID) : null;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required (set BOT_TOKEN env var)");

// MVP: support state in-memory (restart resets it)
const awaitingSupportMessage = new Set<number>();

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }

  return (await res.json()) as T;
}

async function ensureDevice(tgUserId: number) {
  const userId = `tg:${tgUserId}`;
  const body = { userId, platform: "IOS", name: "iphone" };
  return api<{ id: string }>(`/v1/devices`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function provision(deviceId: string) {
  return api<{
    clientConfig: string;
    node: { id: string; endpointHost: string; wgPort: number; serverPublicKey: string };
    peer: { id: string; allowedIp: string; publicKey: string; revokedAt: string | null };
  }>(`/v1/devices/${deviceId}/provision`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function revoke(deviceId: string) {
  return api<{ revoked: boolean; peerId?: string; deviceId?: string; nodeId?: string }>(
    `/v1/devices/${deviceId}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );
}

function mainKeyboard() {
  return new InlineKeyboard()
    .text("Получить VPN", "get_vpn")
    .row()
    .text("Отключить VPN", "revoke_vpn")
    .row()
    .text("Поддержка", "support");
}

const bot = new Bot(BOT_TOKEN);

bot.catch((err) => {
  const e: any = (err as any).error;
  const code = e?.error_code;
  const desc = String(e?.description || "");

  if (code === 403 && /blocked by the user/i.test(desc)) return;
  if (code === 400 && /query is too old|query id is invalid/i.test(desc)) return;

  console.error("BOT_ERROR", err);
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Я могу выдать конфиг WireGuard (.conf) и отключить доступ.\n\nВыбирай действие:",
    { reply_markup: mainKeyboard() }
  );
});

bot.callbackQuery("get_vpn", async (ctx) => {
  await ctx.answerCallbackQuery();
  const tgId = ctx.from?.id;
  if (!tgId) return;

  await ctx.reply("Ок, готовлю конфиг…");

  const dev = await ensureDevice(tgId);
  const data = await provision(dev.id);

  const filename = `cloudgate_${tgId}.conf`;
  const input = new InputFile(Buffer.from(data.clientConfig, "utf8"), filename);

  await ctx.replyWithDocument(input, {
    caption:
      "Вот твой конфиг.\n\n1) Открой WireGuard\n2) Add a tunnel → Import from file\n3) Выбери этот .conf",
    reply_markup: mainKeyboard(),
  });
});

bot.callbackQuery("revoke_vpn", async (ctx) => {
  await ctx.answerCallbackQuery();
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const dev = await ensureDevice(tgId);
  const r = await revoke(dev.id);

  if (r.revoked) {
    await ctx.reply("Отключил доступ. Если надо вернуть, нажми «Получить VPN».", {
      reply_markup: mainKeyboard(),
    });
  } else {
    await ctx.reply("Сейчас доступа и так нет (или уже был отключён).", {
      reply_markup: mainKeyboard(),
    });
  }
});


bot.callbackQuery("support", async (ctx) => {
  await ctx.answerCallbackQuery();
  const tgId = ctx.from?.id;
  if (!tgId) return;

  if (!SUPPORT_CHAT_ID) {
    await ctx.reply("Поддержка пока не настроена (SUPPORT_CHAT_ID не задан).", {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  awaitingSupportMessage.add(tgId);
  await ctx.reply("Напиши одним сообщением, что случилось. Я передам это в поддержку.", {
    reply_markup: mainKeyboard(),
  });
});

function fmtUser(ctx: any) {
  const id = ctx.from?.id;
  const u = ctx.from?.username ? `@${ctx.from.username}` : "(no username)";
  const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim() || "(no name)";
  return { id, u, name };
}

// кто из саппорт-чата сейчас "в режиме ответа" и кому отвечаем
const awaitingSupportReply = new Map<number, number>();

bot.callbackQuery(/^support_reply:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!SUPPORT_CHAT_ID) return;
  if (ctx.chat?.id !== SUPPORT_CHAT_ID) return;

  const adminId = ctx.from?.id;
  if (!adminId) return;

  const targetId = Number(ctx.match?.[1]);
  if (!Number.isFinite(targetId) || targetId <= 0) return;

  awaitingSupportReply.set(adminId, targetId);

  await ctx.reply(
    `Ок. Напиши ответ одним сообщением (я отправлю пользователю tg:${targetId}).`,
    { reply_markup: mainKeyboard() }
  );
});

bot.on("message", async (ctx) => {
  const chatId = ctx.chat?.id;
  const fromId = ctx.from?.id;
  if (!fromId) return;

  // 1) Ответ саппорта в support-чате после нажатия "Ответить"
  if (SUPPORT_CHAT_ID && chatId === SUPPORT_CHAT_ID && awaitingSupportReply.has(fromId)) {
    const targetId = awaitingSupportReply.get(fromId)!;

    const txt = ctx.message?.text?.trim();
    if (!txt) {
      await ctx.reply("Сейчас можно отправить только текстом. Напиши текст ответа одним сообщением.");
      return;
    }

    awaitingSupportReply.delete(fromId);

    await ctx.api.sendMessage(targetId, `Ответ поддержки:

${txt}`, {
      reply_markup: mainKeyboard(),
    });

    await ctx.reply(`Отправил пользователю tg:${targetId}.`);
    return;
  }

  // 2) Сообщение юзера, которое нужно передать в поддержку (любой тип: текст/фото/док)
  if (!awaitingSupportMessage.has(fromId)) return;

  awaitingSupportMessage.delete(fromId);

  if (!SUPPORT_CHAT_ID) {
    await ctx.reply("Поддержка сейчас не настроена.", { reply_markup: mainKeyboard() });
    return;
  }

  const u = fmtUser(ctx);
  const header =
    `SUPPORT REQUEST\n` +
    `from: tg:${u.id} ${u.u}\n` +
    `name: ${u.name}\n`;

  // копируем исходное сообщение как есть (текст, фото, документ и т.д.)
  try {
    await ctx.api.sendMessage(SUPPORT_CHAT_ID, header);
    await ctx.api.copyMessage(SUPPORT_CHAT_ID, chatId!, ctx.message!.message_id);
    await ctx.api.sendMessage(SUPPORT_CHAT_ID, "Ответить пользователю:", {
      reply_markup: new InlineKeyboard().text("Ответить", `support_reply:${u.id}`),
    });
  } catch (e: any) {
    await ctx.reply("Не смог отправить в поддержку (ошибка). Попробуй ещё раз.", {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  await ctx.reply("Принял. Передал в поддержку. Ответим здесь.", {
    reply_markup: mainKeyboard(),
  });
});

bot.start();
