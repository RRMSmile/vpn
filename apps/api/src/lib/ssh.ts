import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function sshExec(params: {
  host: string;
  user: string;
  sshOpts?: string; // "-o BatchMode=yes -o StrictHostKeyChecking=accept-new"
  cmd: string;
  timeoutMs?: number;
}) {
  const args: string[] = [];

  if (params.sshOpts && params.sshOpts.trim()) {
    // простая разбивка; для наших -o норм
    args.push(...params.sshOpts.trim().split(/\s+/g));
  }

  args.push(`${params.user}@${params.host}`);
  args.push(params.cmd);

  const { stdout, stderr } = await execFileAsync("ssh", args, {
    timeout: params.timeoutMs ?? 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return { stdout: stdout ?? "", stderr: stderr ?? "" };
}
