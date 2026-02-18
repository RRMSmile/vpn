#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const API_BASE = process.env.API_BASE ?? "http://localhost:3001";
const ATTEMPTS = Number.parseInt(process.env.SMOKE_ATTEMPTS ?? "3", 10);
const USER_ID = process.env.SMOKE_USER_ID ?? `tg:smoke:${Date.now()}`;
const PLATFORM = process.env.SMOKE_PLATFORM ?? "IOS";
const NAME_PREFIX = process.env.SMOKE_NAME_PREFIX ?? "ci-smoke";
const TIMEOUT_MS = Number.parseInt(process.env.SMOKE_TIMEOUT_MS ?? "15000", 10);

function fail(message) {
  console.error(`FAIL smoke-devices: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    ...options,
  });

  if (result.error) {
    fail(`command error: ${command} ${args.join(" ")} :: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    fail(
      `command failed (${result.status}): ${command} ${args.join(" ")}\nstdout=${stdout}\nstderr=${stderr}`
    );
  }

  return result.stdout ?? "";
}

function runDockerCompose(args, options) {
  return run("docker", ["compose", ...args], options);
}

function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}

function getActivePeerCount(deviceId) {
  const sql = `select count(*) from "Peer" where "deviceId"='${sqlEscape(deviceId)}' and "revokedAt" is null;`;
  const output = runDockerCompose([
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "cloudgate",
    "-d",
    "cloudgate",
    "-t",
    "-A",
    "-c",
    sql,
  ]);

  const value = Number.parseInt(output.trim(), 10);
  if (Number.isNaN(value)) fail(`unable to parse active peer count from "${output.trim()}"`);
  return value;
}

function getAllowedIps(deviceId) {
  const sql =
    `select coalesce(string_agg(distinct "allowedIp", ',' order by "allowedIp"), '') ` +
    `from "Peer" where "deviceId"='${sqlEscape(deviceId)}';`;
  const output = runDockerCompose([
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "cloudgate",
    "-d",
    "cloudgate",
    "-t",
    "-A",
    "-c",
    sql,
  ]).trim();

  if (!output) return [];
  return output
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestJson(method, path, body, expectedStatuses) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    if (!expectedStatuses.includes(response.status)) {
      const payload = typeof json === "string" ? json : JSON.stringify(json);
      fail(`unexpected status for ${method} ${path}: ${response.status}; body=${payload}`);
    }

    return { status: response.status, data: json };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    fail(`request failed for ${method} ${path}: ${details}`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseTokenFromOutput(output) {
  const tokenLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("token="));

  if (!tokenLine) fail(`token line not found in output:\n${output}`);
  const token = tokenLine.slice("token=".length).trim();
  if (!token) fail("empty token in generator output");
  return token;
}

function assertPlans(plansResponse) {
  const items = Array.isArray(plansResponse?.items) ? plansResponse.items : [];
  const codes = new Set(items.map((item) => item?.code).filter(Boolean));

  if (!codes.has("basic") || !codes.has("pro")) {
    fail(`plans invariant failed: expected codes basic/pro, got [${[...codes].join(", ")}]`);
  }
}

async function main() {
  if (!Number.isFinite(ATTEMPTS) || ATTEMPTS < 1) {
    fail(`SMOKE_ATTEMPTS must be >= 1, got ${ATTEMPTS}`);
  }

  console.log(`apiBase=${API_BASE}`);
  console.log("[1/6] health");
  const health = await requestJson("GET", "/health", null, [200]);
  if (!health.data || health.data.ok !== true) {
    fail(`health invariant failed: ${JSON.stringify(health.data)}`);
  }

  console.log("[2/6] seed + plans");
  runDockerCompose(["exec", "-T", "api", "pnpm", "--filter", "@cloudgate/api", "db:seed"], {
    stdio: "inherit",
  });
  const plans = await requestJson("GET", "/v1/plans", null, [200]);
  assertPlans(plans.data);

  console.log("[3/6] create device");
  const name = `${NAME_PREFIX}-${Date.now()}`;
  const create = await requestJson(
    "POST",
    "/v1/devices",
    { userId: USER_ID, platform: PLATFORM, name },
    [200, 201]
  );

  const device = create.data ?? {};
  if (!device.id || !device.deviceId) {
    fail(`device create invariant failed: ${JSON.stringify(device)}`);
  }
  console.log(`device.id=${device.id} device.deviceId=${device.deviceId}`);

  console.log("[4/6] provision retry invariants");
  const observedIps = new Set();
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const provision = await requestJson("POST", `/v1/devices/${device.id}/provision`, {}, [502]);
    if (provision.data?.error !== "WG_ADD_FAILED") {
      fail(`attempt ${attempt} expected WG_ADD_FAILED, got ${JSON.stringify(provision.data)}`);
    }

    const activePeers = getActivePeerCount(device.id);
    if (activePeers !== 0) {
      fail(`attempt ${attempt} invariant failed: activePeers=${activePeers}`);
    }

    const ips = getAllowedIps(device.id);
    for (const ip of ips) observedIps.add(ip);
    if (observedIps.size > 1) {
      fail(`attempt ${attempt} invariant failed: allowedIp drift [${[...observedIps].join(", ")}]`);
    }

    console.log(
      `attempt=${attempt} status=${provision.status} activePeers=${activePeers} allowedIps='${ips.join(",")}'`
    );
    await sleep(200);
  }

  console.log("[5/6] connect token invariants");
  const tokenOutput = runDockerCompose([
    "exec",
    "-T",
    "api",
    "pnpm",
    "--filter",
    "@cloudgate/api",
    "tsx",
    "tools/gen-connect-token.ts",
    "--userId",
    USER_ID,
    "--deviceId",
    device.deviceId,
    "--ttl",
    "600",
  ]);
  const token = parseTokenFromOutput(tokenOutput);

  const connectStatusBefore = await requestJson(
    "GET",
    `/v1/connect/${encodeURIComponent(token)}/status`,
    null,
    [200]
  );
  if (connectStatusBefore.data?.token?.status !== "ready") {
    fail(`connect status before provision must be ready, got ${JSON.stringify(connectStatusBefore.data)}`);
  }

  const publicKey = randomBytes(32).toString("base64");
  const connectProvision = await requestJson(
    "POST",
    `/v1/connect/${encodeURIComponent(token)}/provision`,
    { publicKey },
    [502]
  );
  if (connectProvision.data?.error !== "WG_ADD_FAILED") {
    fail(`connect provision expected WG_ADD_FAILED, got ${JSON.stringify(connectProvision.data)}`);
  }

  const connectStatusAfter = await requestJson(
    "GET",
    `/v1/connect/${encodeURIComponent(token)}/status`,
    null,
    [200]
  );
  if (connectStatusAfter.data?.token?.status !== "ready") {
    fail(`connect status after failed provision must stay ready, got ${JSON.stringify(connectStatusAfter.data)}`);
  }
  if (connectStatusAfter.data?.token?.usedAt !== null) {
    fail(`connect token usedAt must stay null after failed provision, got ${connectStatusAfter.data?.token?.usedAt}`);
  }

  const finalActivePeers = getActivePeerCount(device.id);
  if (finalActivePeers !== 0) {
    fail(`final activePeers invariant failed: ${finalActivePeers}`);
  }

  console.log("[6/6] done");
  console.log("PASS smoke-devices: health/plans/device/connect invariants hold");
}

main().catch((error) => {
  const details = error instanceof Error ? error.message : String(error);
  fail(details);
});
