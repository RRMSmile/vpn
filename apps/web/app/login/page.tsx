"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };
type ApiResp<T> = ApiOk<T> | ApiErr;

type MeOk = ApiOk<{ user: { id: string; email: string; role: string } }>;

function pickNext(nextParam: string | null) {
  const next = (nextParam || "").trim();
  // простая защита от open redirect: разрешаем только относительные пути
  if (!next) return "/dashboard";
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//")) return "/dashboard";
  return next;
}

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const next = useMemo(() => pickNext(sp.get("next")), [sp]);

  const [email, setEmail] = useState("admin@example.com");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<null | "me" | "request" | "pull" | "consume">(null);

  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const isDev = useMemo(() => process.env.NODE_ENV !== "production", []);

  function setError(text: string) {
    setMsg({ kind: "err", text });
  }
  function setInfo(text: string) {
    setMsg({ kind: "info", text });
  }
  function setOk(text: string) {
    setMsg({ kind: "ok", text });
  }

  async function checkMeAndRedirectIfLoggedIn() {
    setBusy("me");
    try {
      const res = await fetch("/api/me", { credentials: "include", cache: "no-store" as any });
      const data = (await res.json()) as MeOk | ApiErr;
      if (res.ok && (data as any).ok) {
        router.replace(next);
        router.refresh();
        return;
      }
    } catch {
      // ignore
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    // если уже есть сессия — не мучаем юзера, уводим дальше
    checkMeAndRedirectIfLoggedIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestMagicLink() {
    setBusy("request");
    setMsg(null);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include"
      });
      const text = await res.text();
      const data = (safeJsonParse<ApiResp<{}>>(text) || { ok: false, error: "bad_json" }) as ApiResp<{}>;
      if (!res.ok || !data.ok) {
        setError((data as ApiErr).error || `request_failed_${res.status}`);
        return;
      }
      setOk("Magic link sent. Check email (dev: MailHog).");
    } catch (e: any) {
      setError(e?.message ?? "request_failed");
    } finally {
      setBusy(null);
    }
  }

  async function pullTokenFromMailhog() {
    if (!isDev) return;
    setBusy("pull");
    setMsg(null);
    try {
      const res = await fetch(`/api/dev/mailhog/latest?email=${encodeURIComponent(email)}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store" as any
      });
      const data = (await res.json()) as ApiResp<{ token: string }>;
      if (!res.ok || !data.ok) {
        setError((data as ApiErr).error || `mailhog_failed_${res.status}`);
        return;
      }
      setToken((data as any).token || "");
      setOk("Token pulled from MailHog.");
    } catch (e: any) {
      setError(e?.message ?? "mailhog_failed");
    } finally {
      setBusy(null);
    }
  }

  async function consumeToken() {
    const t = token.trim();
    if (!t) {
      setError("Token is empty.");
      return;
    }

    setBusy("consume");
    setMsg(null);
    try {
      const res = await fetch("/api/auth/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: t }),
        credentials: "include"
      });

      const data = (await res.json()) as ApiResp<{ user: { email: string } }>;
      if (!res.ok || !data.ok) {
        setError((data as ApiErr).error || `consume_failed_${res.status}`);
        return;
      }

      setOk("Logged in. Redirecting…");
      router.replace(next);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "consume_failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: "6px 0 6px" }}>Login</h1>
      <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 14 }}>
        After login you will be redirected to: <b>{next}</b>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ padding: 16, borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>1) Send magic link</div>

          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 13, opacity: 0.85 }}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "transparent",
                color: "inherit"
              }}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              <button
                onClick={requestMagicLink}
                disabled={busy !== null}
                style={btnStyle(busy === "request")}
              >
                {busy === "request" ? "Sending…" : "Send magic link"}
              </button>

              {isDev && (
                <button
                  onClick={pullTokenFromMailhog}
                  disabled={busy !== null}
                  style={btnStyle(busy === "pull")}
                >
                  {busy === "pull" ? "Pulling…" : "Pull token from MailHog (dev)"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: 16, borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>2) Consume token</div>

          <label style={{ fontSize: 13, opacity: 0.85 }}>Token</label>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="paste token from email / MailHog"
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "inherit",
              marginTop: 6,
              resize: "vertical"
            }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button
              onClick={consumeToken}
              disabled={busy !== null}
              style={btnStyle(busy === "consume")}
            >
              {busy === "consume" ? "Consuming…" : "Consume token"}
            </button>

            <a
              href="/dashboard"
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                textDecoration: "none",
                color: "inherit",
                fontSize: 14,
                opacity: 0.9
              }}
            >
              Go to Dashboard
            </a>
          </div>
        </div>

        {msg && (
          <div style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            opacity: 0.95
          }}>
            <b style={{ textTransform: "uppercase", fontSize: 12, opacity: 0.7 }}>
              {msg.kind}
            </b>
            <div style={{ marginTop: 6 }}>{msg.text}</div>
          </div>
        )}
      </div>
    </main>
  );
}

function safeJsonParse<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: 14
  };
}
