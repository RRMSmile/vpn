import { NextResponse } from "next/server";

export const runtime = "nodejs";

function decodeQuotedPrintableMinimal(s: string) {
  return s.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "not_available" }, { status: 404 });
  }

  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim();
  if (!email) {
    return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });
  }

  try {
    // Внутри docker compose сеть: mailhog доступен как http://mailhog:8025
    const r = await fetch("http://mailhog:8025/api/v2/messages", { cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: "mailhog_unreachable" }, { status: 502 });
    }

    const data = await r.json();
    const items = (data?.items || []) as any[];

    for (const it of items) {
      const headers = it?.Content?.Headers || {};
      const to = (headers?.To?.[0] || "") as string;
      if (!to.includes(email)) continue;

      const rawBody = (it?.Content?.Body || "") as string;
      const body = decodeQuotedPrintableMinimal(rawBody);
      const m = body.match(/token=([0-9a-f]{40,})/i);

      if (m?.[1]) {
        return NextResponse.json({ ok: true, token: m[1] });
      }
    }

    return NextResponse.json({ ok: false, error: "token_not_found" }, { status: 404 });
  } catch {
    return NextResponse.json({ ok: false, error: "mailhog_error" }, { status: 500 });
  }
}
