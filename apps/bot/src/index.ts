import { Bot, InlineKeyboard } from "grammy";
// Node 20+ provides global fetch (undici is built-in).

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const API_BASE = (process.env.API_BASE || "http://api:3001").replace(/\/$/, "");

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");

const bot = new Bot(BOT_TOKEN);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Не валим процесс на частых телеграм-ошибках (юзер заблокировал бота, протухший callback).
bot.catch((err) => {
  const e: any = (err as any).error;
  const code = e?.error_code;
  const desc = String(e?.description || "");

  if (code === 403 && /blocked by the user/i.test(desc)) return;
  if (code === 400 && /query is too old|query id is invalid/i.test(desc)) return;

  console.error("BOT_ERR", err);
});

async function startPollingForever() {
  for (;;) {
    try {
      console.log("[bot] start long polling");
      // чистим накопившиеся апдейты, чтобы не ловить "query is too old"
      await bot.start({ drop_pending_updates: true });
      console.log("[bot] polling stopped (unexpected), restart in 2000ms");
      await sleep(2000);
    } catch (e: any) {
      const code = e?.error_code;
      const desc = e?.description || e?.message || String(e);
      const waitMs = code === 409 ? 5000 : 2000;
      console.error(`[bot] polling crash (code=${code}), restart in ${waitMs}ms:`, desc);
      await sleep(waitMs);
    }
  }
}


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
    .text("Получить VPN", "getvpn")
    .row()
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


bot.callbackQuery("getvpn", async (ctx: any) => {
  const userId = tgUserId(ctx);
  if (!userId) {
    await ctx.answerCallbackQuery({ text: "Нет userId" });
    return;
  }

  try {
    await ctx.answerCallbackQuery({ text: "Готовлю VPN..." });

    // 1) create/get device (idempotent)
    const d = await apiPost("/v1/devices", { userId, platform: "IOS", name: "iphone" });
    const id = d?.id;
    if (!id) throw new Error("API: /v1/devices did not return id");

    // 2) provision (endpoint expects JSON object body)
    const prov = await apiPost("/v1/devices/" + encodeURIComponent(id) + "/provision", {});

    const pretty = JSON.stringify(prov, null, 2);
    const out = pretty.length > 3500 ? pretty.slice(0, 3500) + "\n...(truncated)" : pretty;

    await ctx.editMessageText("VPN готов. Ответ API (временно JSON):\n\n" + out, {
      reply_markup: mainKb(),
    });
  } catch (e: any) {
    await ctx.answerCallbackQuery({ text: "Ошибка" });
    await ctx.reply(`Ошибка getvpn: ${e?.message ?? e}`);
  }
});



startPollingForever();