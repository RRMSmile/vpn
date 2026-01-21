#!/usr/bin/env node
/**
 * WireGuard reconciliation: DB -> Node
 * Default: dry-run; apply: --apply (needs CONFIRM=YES)
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

type DesiredPeer = { nodeId: string; publicKey: string; allowedIp: string };
type ActualPeer = { publicKey: string; allowedIps: string[] };

type PlanAction =
  | { kind: "add"; publicKey: string; allowedIpCidr: string }
  | { kind: "update"; publicKey: string; allowedIpCidr: string }
  | { kind: "remove"; publicKey: string };

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const VERBOSE = argv.includes("--verbose");
const NODE_ID_FILTER = (() => {
  const i = argv.indexOf("--node-id");
  return i === -1 ? undefined : argv[i + 1];
})();

const WG_INTERFACE = process.env.WG_INTERFACE || "wg0";
const SSH_HOST = process.env.WG_NODE_SSH_HOST || "wg-node-1";
const SSH_USER = process.env.WG_NODE_SSH_USER || "root";
const SSH_PORT = process.env.WG_NODE_SSH_PORT || "22";
const SSH_IDENTITY = process.env.WG_NODE_SSH_IDENTITY;
function parseSshOpts(raw: string | undefined): string[] {
  if (!raw) return [];
  // raw is like: "-o A=B -o C=D"
  // naive split is OK because we control the env format
  return raw.trim().split(/\s+/).filter(Boolean);
}

const SUDO = process.env.WG_NODE_SSH_SUDO === "1";

function log(msg: string) { process.stdout.write(msg + "\n"); }
function warn(msg: string) { process.stderr.write(msg + "\n"); }
function fatal(msg: string): never { warn(msg); process.exit(1); }

function normCidr(ipOrCidr: string): string {
  const s = ipOrCidr.trim();
  if (!s) return s;
  return s.includes("/") ? s : `${s}/32`;
}
function pickPrimaryAllowedIp(allowedIps: string[]): string | undefined {
  const a32 = allowedIps.find((x) => x.endsWith("/32"));
  return a32 || allowedIps[0];
}

function sshArgs(): string[] {
  const args: string[] = [
    "-p", SSH_PORT,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
  ];
  if (SSH_IDENTITY) args.push("-i", SSH_IDENTITY);
  return args;
}

function isLikelyWgPublicKey(k: string): boolean {
  // wg pubkey is base64, typically 44 chars with '=' padding, but be tolerant
  return /^[A-Za-z0-9+/]{42,}={0,2}$/.test(k) && !k.includes("REPLACE_WITH");
}
function sshExec(command: string): string {
  const optArgs = parseSshOpts(process.env.WG_NODE_SSH_OPTS);
  const args = [
    "-p", String(SSH_PORT),
    ...optArgs,
    ...(SSH_IDENTITY ? ["-i", SSH_IDENTITY] : []),
    `${SSH_USER}@${SSH_HOST}`,
    command,
  ];
  if (VERBOSE) log(`[ssh] ${SSH_USER}@${SSH_HOST}: ${command}`);
  return execFileSync("ssh", args, { encoding: "utf8" }).toString();
}
function wgDump(): string {
  return sshExec(`${SUDO ? "sudo " : ""}wg show ${WG_INTERFACE} dump`);
}
function parseWgDump(text: string): ActualPeer[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const peerLines = lines.slice(1);
  const peers: ActualPeer[] = [];
  for (const line of peerLines) {
    const cols = line.split("\t");
    const publicKey = cols[0];
    const allowedIpsCol = cols[3] || "";
    const allowedIps = allowedIpsCol.split(",").map((x) => x.trim()).filter(Boolean);
    if (!publicKey) continue;
    peers.push({ publicKey, allowedIps });
  }
  return peers;
}

async function loadDesiredPeers(prisma: PrismaClient): Promise<DesiredPeer[]> {
  const rows = await prisma.peer.findMany({
    where: { revokedAt: null, ...(NODE_ID_FILTER ? { nodeId: NODE_ID_FILTER } : {}) } as any,
    select: { nodeId: true, publicKey: true, allowedIp: true } as any,
  });
  const out: DesiredPeer[] = [];
  for (const r of rows as any[]) {
    if (!r?.nodeId || !r?.publicKey || !r?.allowedIp) continue;
    out.push({ nodeId: String(r.nodeId), publicKey: String(r.publicKey), allowedIp: String(r.allowedIp) });
  }
  return out;
}

function buildPlan(desired: DesiredPeer[], actual: ActualPeer[]): PlanAction[] {
  const desiredByKey = new Map<string, string>();
  for (const d of desired) desiredByKey.set(d.publicKey, normCidr(d.allowedIp));

  const actualByKey = new Map<string, string>();
  for (const a of actual) {
    const primary = pickPrimaryAllowedIp(a.allowedIps);
    if (!primary) continue;
    actualByKey.set(a.publicKey, normCidr(primary));
  }

  const plan: PlanAction[] = [];
  for (const [pub, want] of desiredByKey.entries()) {
    const have = actualByKey.get(pub);
    if (!have) plan.push({ kind: "add", publicKey: pub, allowedIpCidr: want });
    else if (have !== want) plan.push({ kind: "update", publicKey: pub, allowedIpCidr: want });
  }
  for (const [pub] of actualByKey.entries()) {
    if (!desiredByKey.has(pub)) plan.push({ kind: "remove", publicKey: pub });
  }

  plan.sort((a, b) => {
    const rank = (x: PlanAction) => (x.kind === "remove" ? 2 : x.kind === "update" ? 1 : 0);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.publicKey.localeCompare(b.publicKey);
  });
  return plan;
}

function formatPlan(plan: PlanAction[]): string {
  if (plan.length === 0) return "PLAN: no changes";
  const lines: string[] = [`PLAN: ${plan.length} change(s)`];
  for (const p of plan) {
    if (p.kind === "remove") lines.push(`- remove ${p.publicKey}`);
    if (p.kind === "add") lines.push(`+ add    ${p.publicKey} -> ${p.allowedIpCidr}`);
    if (p.kind === "update") lines.push(`~ update ${p.publicKey} -> ${p.allowedIpCidr}`);
  }
  return lines.join("\n");
}

function applyPlan(plan: PlanAction[]) {
  for (const p of plan) {
    if (p.kind === "remove") sshExec(`${SUDO ? "sudo " : ""}wg set ${WG_INTERFACE} peer ${p.publicKey} remove`);
    else sshExec(`${SUDO ? "sudo " : ""}wg set ${WG_INTERFACE} peer ${p.publicKey} allowed-ips ${p.allowedIpCidr}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) fatal("DATABASE_URL is not set");

  log(`WG reconcile (host=${SSH_HOST}, iface=${WG_INTERFACE})`);
  log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}${NODE_ID_FILTER ? ` (nodeId=${NODE_ID_FILTER})` : ""}`);

  const prisma = new PrismaClient();
  try {
    const desired = await loadDesiredPeers(prisma);
    if (desired.length === 0) warn("WARN: DB desired peers is empty (state=ACTIVE). With --apply this would remove all peers from node.");

    const actual = parseWgDump(wgDump());
    if (VERBOSE) { log(`DB desired: ${desired.length}`); log(`WG actual: ${actual.length}`); }

    const plan = buildPlan(desired, actual);
    log(formatPlan(plan));

    if (!APPLY) { log("OK: dry-run complete (use --apply to execute)"); return; }
    if (process.env.CONFIRM !== "YES") fatal("Refusing to apply without CONFIRM=YES");
    if (plan.length === 0) { log("OK: nothing to apply"); return; }

    for (const a of plan) {
      if (!isLikelyWgPublicKey(a.publicKey)) fatal(`Invalid publicKey in plan: ${a.publicKey}`);
    }
    applyPlan(plan);
    log("OK: apply complete");
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((e) => { warn(String((e && (e.stack || e)) || e)); process.exit(1); });
