"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

export default function Admin() {
  const [me, setMe] = useState<any>(null);
  const [servers, setServers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    name: "wg-1",
    host: "1.2.3.4",
    endpointHost: "vpn.example.com",
    endpointPort: 51820
  });

  useEffect(() => {
    (async () => {
      const r = await apiFetch("/me");
      setMe((await r.json()).user);

      const s = await apiFetch("/servers");
      if (s.ok) setServers((await s.json()).items);
    })();
  }, []);

  async function createServer() {
    const r = await apiFetch("/servers", { method: "POST", body: JSON.stringify(form) });
    if (!r.ok) return;
    const s = await apiFetch("/servers");
    if (s.ok) setServers((await s.json()).items);
  }

  if (me === null) return <main style={{ padding: 24 }}>Загрузка…</main>;
  if (!me || me.role !== "admin") return <main style={{ padding: 24 }}>Нет доступа</main>;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Админка</h1>

      <h2>VPN-сервера</h2>
      <pre style={{ background: "#f6f6f6", padding: 12 }}>{JSON.stringify(servers, null, 2)}</pre>

      <h3>Добавить сервер</h3>
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="name" />
      <input value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} placeholder="ssh host/ip" />
      <input value={form.endpointHost} onChange={e => setForm({ ...form, endpointHost: e.target.value })} placeholder="endpoint host" />
      <input value={String(form.endpointPort)} onChange={e => setForm({ ...form, endpointPort: Number(e.target.value) })} placeholder="endpoint port" />
      <div style={{ height: 8 }} />
      <button onClick={createServer}>Create</button>
    </main>
  );
}