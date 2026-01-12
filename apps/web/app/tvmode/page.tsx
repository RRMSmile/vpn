"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

export default function TVMode() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const r = await apiFetch("/tvmode");
      setData(await r.json());
    })();
  }, []);

  if (!data) return <main style={{ padding: 24 }}>Загрузка…</main>;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>TV Mode</h1>
      <p>DNS:</p>
      <pre>{JSON.stringify(data.dns, null, 2)}</pre>

      <h2>LG</h2>
      <ol>{data.instructions.lg.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>

      <h2>Samsung</h2>
      <ol>{data.instructions.samsung.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>

      <h2>Android TV</h2>
      <ol>{data.instructions.androidtv.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
    </main>
  );
}