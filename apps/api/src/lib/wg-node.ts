import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../env";

const execFileAsync = promisify(execFile);

type SshExecOpts = {
  host: string;
  user: string;
  opts?: string; // extra ssh options as string, e.g. "-i /path/to/key"
};

async function sshExec(cmd: string, ssh: SshExecOpts): Promise<{ stdout: string; stderr: string }> {
  const args: string[] = [];

  // Non-interactive, do not prompt for host key
  args.push("-o", "BatchMode=yes");
  args.push("-o", "StrictHostKeyChecking=no");

  if (ssh.opts) {
    args.push(...ssh.opts.split(" ").filter(Boolean));
  }

  args.push(`${ssh.user}@${ssh.host}`, cmd);

  const { stdout, stderr } = await execFileAsync("ssh", args, { timeout: 30_000 });
  return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
}

export async function wgAddPeer(params: {
  publicKey: string;
  allowedIp: string; // e.g. "10.8.0.11"
  node: { sshHost: string; sshUser: string; wgInterface: string };
}) {
  const { publicKey, allowedIp, node } = params;

  const cmd = [
    "set -euo pipefail;",
    `sudo -n wg set ${node.wgInterface} peer ${publicKey} allowed-ips ${allowedIp}/32;`,
    `sudo -n wg show ${node.wgInterface} | sed -n "1,40p";`,
  ].join(" ");

  return sshExec(cmd, {
    host: node.sshHost,
    user: node.sshUser,
    opts: env.WG_NODE_SSH_OPTS,
  });
}

export async function wgRemovePeer(params: {
  publicKey: string;
  node: { sshHost: string; sshUser: string; wgInterface: string };
}) {
  const { publicKey, node } = params;

  const cmd = [
    "set -euo pipefail;",
    `sudo -n wg set ${node.wgInterface} peer ${publicKey} remove;`,
    `sudo -n wg show ${node.wgInterface} | sed -n "1,40p";`,
  ].join(" ");

  return sshExec(cmd, {
    host: node.sshHost,
    user: node.sshUser,
    opts: env.WG_NODE_SSH_OPTS,
  });
}
