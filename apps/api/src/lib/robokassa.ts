import crypto from "node:crypto";

export type RoboHashAlg = "MD5" | "SHA256";

export function formatOutSum(amountKopeks: number, isTest: boolean): string {
  if (amountKopeks < 0) throw new Error("amountKopeks must be >= 0");
  const rub = Math.floor(amountKopeks / 100);
  const kop = amountKopeks % 100;

  if (isTest) {
    // test: integer (assume kopeks=0)
    if (kop !== 0) throw new Error("Test mode requires whole ruble amounts (kopeks=0)");
    return String(rub);
  }

  // prod: rubles with 6 decimals (kopeks=2 decimals + 4 zeros)
  return `${rub}.${String(kop).padStart(2, "0")}0000`;
}

export function hashHex(input: string, alg: RoboHashAlg): string {
  const a = alg === "SHA256" ? "sha256" : "md5";
  return crypto.createHash(a).update(input, "utf8").digest("hex");
}

export function pickShpParams(params: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("Shp_") || k.startsWith("shp_")) out.push([k, String(v ?? "")]);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

export function buildPaymentSigBase(args: {
  merchantLogin: string;
  outSum: string;
  invId: string;
  password1: string;
  shp?: Array<[string, string]>;
}): string {
  const parts = [args.merchantLogin, args.outSum, args.invId, args.password1];
  for (const [k, v] of args.shp ?? []) parts.push(`${k}=${v}`);
  return parts.join(":");
}

export function buildResultSigBase(args: {
  outSum: string;
  invId: string;
  password2: string;
  shp?: Array<[string, string]>;
}): string {
  const parts = [args.outSum, args.invId, args.password2];
  for (const [k, v] of args.shp ?? []) parts.push(`${k}=${v}`);
  return parts.join(":");
}

export function normSig(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}
