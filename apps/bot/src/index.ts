import { Bot, InlineKeyboard } from "grammy";
// Node 20+ provides global fetch (undici is built-in).

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const API_BASE = process.env.API_BASE || "http://api:3001";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");

const bot = new Bot(BOT_TOKEN);

function tgUserId(ctx: any) {
  const id = ctx.from?.id;
  return id ? `tg:${id}` : null;
}

async function apiGet(path: string) {
  const r = await fetch(`${API_BASE}${path}`);
  const t = await r.text();
  if (!r.ok) throw new Error(`API ${r.status}: ${t}`);
  return JSON.parse(t);
}

async function apiPost(path: string, body: any) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`API ${r.status}: ${t}`);
  return JSON.parse(t);
}

function mainKb() {
  return new InlineKeyboard()
    .text("Тарифы", "plans")
    .text("Подписка", "sub");
}

bot.command("start", async (ctx: any) => {
  await ctx.reply("CloudGate.\n\nВыбери действие:", { reply_markup: mainKb() });
});

bot.callbackQuery("plans", async (ctx: any) => {
  try {
    const plans = await apiGet("/v1/plans");
    const items = plans?.items ?? plans ?? [];
    const lines = items.map((p: any) => {
      const price = p.priceKopeks != null ? `${(Number(p.priceKopeks) / 100).toFixed(2)} ₽` : "—";
      const limit = p.deviceLimit != null ? `${p.deviceLimit}` : "—";
      return `• ${p.title ?? p.name ?? p.id} — ${price} / лимит ${limit}`;
    });

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(lines.length ? `Тарифы:\n${lines.join("\n")}` : "Тарифы не найдены", {
      reply_markup: mainKb(),
    });
  } catch (e: any) {
    await ctx.answerCallbackQuery({ text: "Ошибка загрузки тарифов" });
    await ctx.reply(`Ошибка: ${e?.message ?? e}`);
  }
});

bot.callbackQuery("sub", async (ctx: any) => {
  const userId = tgUserId(ctx);
  if (!userId) {
    await ctx.answerCallbackQuery({ text: "Нет userId" });
    return;
  }

  try {
    // временно: ожидаем endpoint /v1/subscriptions/:userId
    const s = await apiGet(`/v1/subscriptions/${encodeURIComponent(userId)}`);

    const text =
      `Подписка:\n` +
      `Статус: ${s.status ?? "—"}\n` +
      `До: ${s.activeUntil ?? "—"}\n` +
      `Лимит устройств: ${s.deviceLimit ?? "—"}`;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, { reply_markup: mainKb() });
  } catch (e: any) {
    await ctx.answerCallbackQuery({ text: "Нет данных" });
    await ctx.reply(`Подписка не найдена или ошибка: ${e?.message ?? e}`);
  }
});

bot.catch((err: any) => {
  console.error("BOT_ERR", err);
});

bot.start();

