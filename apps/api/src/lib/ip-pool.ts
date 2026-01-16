function ipToInt(ip: string): number {
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    throw new Error(`Bad IP: ${ip}`);
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function pickFreeIp(used: Set<string>): string {
  const start = process.env.WG_POOL_START || "10.8.0.2";
  const end = process.env.WG_POOL_END || "10.8.0.254";
  const a = ipToInt(start);
  const b = ipToInt(end);
  if (b < a) throw new Error("WG_POOL_END < WG_POOL_START");

  for (let n = a; n <= b; n++) {
    const ip = intToIp(n);
    if (!used.has(ip)) return ip;
  }
  throw new Error("IP pool exhausted");
}
