"use client";

import React, { useEffect, useState } from "react";

type MeOk = { ok: true; user: { id: string; email: string; role: string } };
type MeErr = { ok: false; error: string };

export default function HomePage() {
  const [me, setMe] = useState<MeOk["user"] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/me", { credentials: "include", cache: "no-store" as any });
        const data = (await res.json()) as MeOk | MeErr;
        if (cancelled) return;
        if (res.ok && data.ok) setMe(data.user);
        else setMe(null);
      } catch {
        if (cancelled) return;
        setMe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const next = "/dashboard";

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: "6px 0 8px" }}>CloudGate</h1>
      <div style={{ opacity: 0.75, marginBottom: 16 }}>
        MVP: magic-link auth → cookie session → protected pages.
      </div>

      <div style={{ padding: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Status</div>
          <div style={{ opacity: 0.7, fontSize: 13 }}>
            {loading ? "checking…" : me ? `logged in as ${me.email} (${me.role})` : "guest"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          {me ? (
            <a href={next} style={btn()}>Open Dashboard</a>
          ) : (
            <a href={`/login?next=${encodeURIComponent(next)}`} style={btn()}>Login</a>
          )}
          <a href="/api/health" style={btn(true)}>API health</a>
          <a href="http://localhost:8025" target="_blank" rel="noreferrer" style={btn(true)}>MailHog (dev)</a>
        </div>
      </div>
    </main>
  );
}

function btn(secondary = false): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    textDecoration: "none",
    color: "inherit",
    fontSize: 14,
    opacity: secondary ? 0.85 : 1
  };
}
