"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type MeOk = { ok: true; user: { id: string; email: string; role: string } };
type MeErr = { ok: false; error: string };

export default function NavBar() {
  const router = useRouter();
  const pathname = usePathname();

  const [me, setMe] = useState<MeOk["user"] | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadMe() {
    setLoading(true);
    try {
      const res = await fetch("/api/me", { credentials: "include", cache: "no-store" as any });
      const data = (await res.json()) as MeOk | MeErr;
      if (res.ok && data.ok) setMe(data.user);
      else setMe(null);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadMe(); }, [pathname]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      setMe(null);
      router.push("/login?next=" + encodeURIComponent("/dashboard"));
      router.refresh();
    }
  }

  const pill = (text: string) => (
    <span style={{
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.14)",
      fontSize: 12,
      opacity: 0.9
    }}>{text}</span>
  );

  return (
    <div style={{
      position: "sticky",
      top: 0,
      zIndex: 50,
      backdropFilter: "blur(8px)",
      background: "rgba(0,0,0,0.35)",
      borderBottom: "1px solid rgba(255,255,255,0.08)"
    }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "12px 24px", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <a href="/" style={{ color: "inherit", textDecoration: "none", fontWeight: 800 }}>CloudGate</a>
          <a href="/dashboard" style={linkStyle()}>Dashboard</a>
          <a href="/login?next=%2Fdashboard" style={linkStyle()}>Login</a>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {loading ? pill("checking…") : me ? pill(`${me.email} (${me.role})`) : pill("guest")}

          {me ? (
            <button onClick={logout} style={btnStyle()}>
              Logout
            </button>
          ) : (
            <a href="/login?next=%2Fdashboard" style={{ ...btnStyle(), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Sign in
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function linkStyle(): React.CSSProperties {
  return {
    color: "inherit",
    textDecoration: "none",
    opacity: 0.85,
    fontSize: 14
  };
}

function btnStyle(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: 14
  };
}
