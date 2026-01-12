"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type MeOk = { ok: true; user: { id: string; email: string; role: string } };
type MeErr = { ok: false; error: string };

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [state, setState] = useState<"checking" | "ok" | "no">("checking");
  const [me, setMe] = useState<MeOk["user"] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      setState("checking");
      try {
        const res = await fetch("/api/me", { credentials: "include", cache: "no-store" as any });
        const data = (await res.json()) as MeOk | MeErr;

        if (cancelled) return;

        if (res.ok && data.ok) {
          setMe(data.user);
          setState("ok");
          return;
        }

        setMe(null);
        setState("no");

        const next = encodeURIComponent(pathname || "/dashboard");
        router.replace(`/login?next=${next}`);
        router.refresh();
      } catch {
        if (cancelled) return;
        setMe(null);
        setState("no");
        const next = encodeURIComponent(pathname || "/dashboard");
        router.replace(`/login?next=${next}`);
        router.refresh();
      }
    }

    check();

    return () => { cancelled = true; };
  }, [pathname, router]);

  if (state === "checking") {
    return (
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 24, opacity: 0.8 }}>
        Checking session…
      </div>
    );
  }

  if (state === "no") {
    // редирект уже случился, просто показываем пустой экран
    return (
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 24, opacity: 0.8 }}>
        Redirecting to login…
      </div>
    );
  }

  return <>{children}</>;
}
