import { Bot, InlineKeyboard, InputFile } from "grammy";
import { Buffer } from "node:buffer";

const BOT_TOKEN =
  process.env.BOT_TOKEN ||
  process.env.UX_BOT_TOKEN ||
  process.env.PROD_BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");

const API_BASE =
  process.env.API_BASE ||
  process.env.API_BASE_URL ||
  "http://api:3001";

const TRIAL_MS = Number(process.env.TRIAL_MS || 5 * 60 * 1000);

// Node 20: fetch есть, но типы могут быть капризными в tsc, поэтому any.
const fetchAny: any = (globalThis as any).fetch;

const bot = new Bot(BOT_TOKEN);
console.log("[bot] boot", { API_BASE, TRIAL_MS });

const deviceIdByUser = new Map<string, string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

bot.catch((err) => {
  const e: any = (err as any).error;
  const code = e?.error_code;
  const desc = String(e?.description || "");

  if (code === 403 && /blocked by the user/i.test(desc)) return;
  if (code === 400 && /query is too old|query id is invalid/i.test(desc)) return;

  console.error("bot error:", err);
});
function mainKeyboard() {
  return new InlineKeyboard()
    .text("Подключить VPN (5 минут бесплатно)", "get_vpn")
    .row()
    .text("Отключить VPN", "revoke_vpn")
    .row()
    .text("Поддержка", "support");
}

function payKeyboard() {
  return new InlineKeyboard()
    .text("Продлить на 1 день", "pay_day")
    .row()
    .text("Подписка на месяц", "pay_month")
    .row()
    .text("Поддержка", "support");
}

async function createDeviceForUser(userId: string): Promise<string> {
  if (!fetchAny) throw new Error("fetch is not available in this runtime");

  const resp = await fetchAny(`${API_BASE}/v1/devices`, {
    method: "POST",
    headers: { "content-type": "application/json" } as any,
    body: JSON.stringify({
      userId,
      platform: "IOS",
      name: "telegram",
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`createDevice failed: ${resp.status} ${txt}`);
  }

  const j: any = await resp.json().catch(() => ({}));
  const deviceId = String(j?.id || "");
  if (!deviceId) throw new Error(`createDevice: no id in response keys=${Object.keys(j || {})}`);
  return deviceId;
}

async function provisionForUser(userId: string): Promise<{ deviceId: string; conf: string }> {
  if (!fetchAny) throw new Error("fetch is not available in this runtime");

  let deviceId = deviceIdByUser.get(userId);
  if (!deviceId) {
    deviceId = await createDeviceForUser(userId);
    deviceIdByUser.set(userId, deviceId);
  }

  const resp = await fetchAny(`${API_BASE}/v1/devices/${encodeURIComponent(deviceId)}/provision`, {
    method: "POST",
    headers: { "content-type": "application/json" } as any,
    body: JSON.stringify({ trialMs: TRIAL_MS }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`provision failed: ${resp.status} ${txt}`);
  }

  const j: any = await resp.json().catch(() => ({}));

  // вытаскиваем wg-конфиг из любого места JSON (clientConfig и т.п.)
  const conf =
    j?.clientConfig ||
    j?.config ||
    j?.conf ||
    j?.wgConfig ||
    j?.data?.clientConfig ||
    j?.data?.config ||
    j?.data?.conf ||
    j?.data?.wgConfig ||
    "";

  if (!conf) {
    console.error("[bot] provision JSON keys:", Object.keys(j || {}));
    throw new Error("provision: no client config in response");
  }

  return { deviceId, conf: String(conf) };
}

async function revokeForUser(userId: string): Promise<void> {
  if (!fetchAny) throw new Error("fetch is not available in this runtime");

  const deviceId = deviceIdByUser.get(userId);
  if (!deviceId) return;

  // endpoint ожидаем такой (как в API роутере). Если будет иначе — подправим.
  const resp = await fetchAny(`${API_BASE}/v1/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" } as any,
    body: JSON.stringify({}),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`revoke failed: ${resp.status} ${txt}`);
  }
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Привет! Я выдам конфиг WireGuard и включу VPN на 5 минут бесплатно.\n\nЖми кнопку ниже:",
    { reply_markup: mainKeyboard() }
  );
});

bot.callbackQuery("support", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Поддержка: напиши сюда и приложи скрин, если есть проблема.");
});

bot.callbackQuery("pay_day", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Ок. Продление на 1 день добавим позже. Сейчас работает тестовый доступ 5 минут.", { reply_markup: payKeyboard() });
});

bot.callbackQuery("pay_month", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Ок. Подписку на месяц добавим позже. Сейчас работает тестовый доступ 5 минут.", { reply_markup: payKeyboard() });
});

bot.callbackQuery("get_vpn", async (ctx) => {
  const userId = `tg:${ctx.from?.id}`;
  console.log("[bot] get_vpn userId=", userId);

  await ctx.answerCallbackQuery();

  try {
    await ctx.reply("Готовлю конфиг…");
    const { conf } = await provisionForUser(userId);

    const filename = "safevpn.conf";
    const file = new InputFile(Buffer.from(conf, "utf-8"), filename);

    await ctx.replyWithDocument(file, {
      caption: "Вот твой .conf\n\nОткрой WireGuard → Add tunnel → Import from file (или через Files) → включи.",
    });

    await ctx.reply("Если доступ закончится — появится экран оплаты.", { reply_markup: mainKeyboard() });
  } catch (e: any) {
    console.error("[bot] get_vpn failed:", e);
    await ctx.reply(`Ошибка: ${String(e?.message || e)}`);
  }
});

bot.callbackQuery("revoke_vpn", async (ctx) => {
  const userId = `tg:${ctx.from?.id}`;
  console.log("[bot] revoke_vpn userId=", userId);

  await ctx.answerCallbackQuery();

  try {
    await revokeForUser(userId);
    await ctx.reply("Ок, доступ отключён.", { reply_markup: mainKeyboard() });
  } catch (e: any) {
    console.error("[bot] revoke_vpn failed:", e);
    await ctx.reply(`Не смог отключить: ${String(e?.message || e)}`);
  }
});

async function startPollingForever() {
  for (;;) {
    try {
      console.log("[bot] polling start");
      await bot.start();
      console.log("[bot] polling stopped");
    } catch (e) {
      console.error("[bot] polling crashed; retry in 2s:", e);
      await sleep(2000);
    }
  }
}

void startPollingForever();
