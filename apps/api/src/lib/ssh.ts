import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function splitArgs(s: string): string[] {
  if (!s) return [];
  return s.split(/\s+/).filter(Boolean);
}

export async function sshExec(cmd: string): Promise<{ stdout: string; stderr: string }> {
  const host = (process.env.WG_NODE_SSH_HOST || "").trim();
  const user = (process.env.WG_NODE_SSH_USER || "yc-user").trim();
  if (!host) throw new Error("WG_NODE_SSH_HOST is empty");

  const opts = (process.env.WG_NODE_SSH_OPTS || "-o BatchMode=yes -o StrictHostKeyChecking=accept-new").trim();
  const args = [...splitArgs(opts), `${user}@${host}`, cmd];

  const { stdout, stderr } = await execFileAsync("ssh", args, {
    timeout: 20_000,
    maxBuffer: 5_000_000
  });

  return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
}
