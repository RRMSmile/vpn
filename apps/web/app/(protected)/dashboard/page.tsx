"use client";

import React, { useEffect, useState } from "react";

type MeOk = { ok: true; user: { id: string; email: string; role: string } };
type MeErr = { ok: false; error: string };

export default function DashboardPage() {
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

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: "6px 0 10px" }}>Dashboard</h1>

      <div style={{ padding: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)" }}>
        {loading ? (
          <div style={{ opacity: 0.8 }}>Loading…</div>
        ) : me ? (
          <>
            <div style={{ fontWeight: 800, fontSize: 16 }}>You are logged in</div>
            <div style={{ marginTop: 8, opacity: 0.9, lineHeight: 1.6 }}>
              <div><b>Email:</b> {me.email}</div>
              <div><b>Role:</b> {me.role}</div>
              <div><b>User ID:</b> {me.id}</div>
            </div>

            <div style={{ marginTop: 14, opacity: 0.7, fontSize: 13 }}>
              Next MVP: Projects, Nodes, Subscription.
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.8 }}>No session</div>
        )}
      </div>
    </main>
  );
}
