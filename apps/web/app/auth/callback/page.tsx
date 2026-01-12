"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };
type ApiResp<T> = ApiOk<T> | ApiErr;

function safeJsonParse<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

function CallbackInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const [status, setStatus] = useState<"init" | "busy" | "ok" | "err">("init");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const token = (sp.get("token") || "").trim();
    if (!token) {
      setStatus("err");
      setError("Нет token в URL. Вернись на /login и вставь токен вручную.");
      return;
    }

    (async () => {
      setStatus("busy");
      setError("");

      try {
        const res = await fetch("/api/auth/consume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
          credentials: "include"
        });

        const text = await res.text();
        const data = safeJsonParse<ApiResp<{ user: any }>>(text);

        if (!res.ok || !data || data.ok === false) {
          const err = data && "error" in data ? data.error : `consume failed (${res.status})`;
          setStatus("err");
          setError(err);
          return;
        }

        setStatus("ok");
        router.push("/dashboard");
        router.refresh();
      } catch (e: any) {
        setStatus("err");
        setError(e?.message ?? "consume failed");
      }
    })();
  }, [sp, router]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: "8px 0 6px" }}>Authorizing…</h1>

      {status === "busy" && <p style={{ opacity: 0.85 }}>Consume token, ставлю cookie…</p>}
      {status === "ok" && <p style={{ opacity: 0.85 }}>Ок. Редирект…</p>}

      {status === "err" && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
          <b style={{ textTransform: "uppercase", fontSize: 12, opacity: 0.7 }}>error</b>
          <div style={{ marginTop: 6 }}>{error}</div>
          <div style={{ marginTop: 10 }}>
            <a href="/login" style={{ color: "inherit" }}>Вернуться на /login</a>
          </div>
        </div>
      )}
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
