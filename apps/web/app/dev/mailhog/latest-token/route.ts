import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function decodeQuotedPrintableMinimal(s: string): string {
  // достаточно для нашей задачи: убрать soft-break и вернуть '=' из '=3D'
  return s.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim();

  const base = process.env.MAILHOG_BASE_URL || "http://mailhog:8025";
  const mhUrl = `${base.replace(/\/+$/,"")}/api/v2/messages`;

  try {
    const res = await fetch(mhUrl, { method: "GET", cache: "no-store" as any });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `mailhog_fetch_failed_${res.status}` }, { status: 502 });
    }

    const data = await res.json() as any;
    const items: any[] = Array.isArray(data?.items) ? data.items : [];

    const tokenRe = /token=([0-9a-f]{40,})/i;

    for (const it of items) {
      const headers = it?.Content?.Headers || {};
      const to = Array.isArray(headers?.To) ? String(headers.To[0] || "") : "";
      if (email && !to.includes(email)) continue;

      const body = String(it?.Content?.Body || "");
      const decoded = decodeQuotedPrintableMinimal(body);
      const m = decoded.match(tokenRe);
      if (m?.[1]) {
        return NextResponse.json({ ok: true, token: m[1] });
      }
    }

    return NextResponse.json({ ok: false, error: "token_not_found" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "mailhog_error" }, { status: 500 });
  }
}
