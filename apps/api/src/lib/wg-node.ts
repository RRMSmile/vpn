import { sshExec } from "./ssh";

export async function wgSetPeer(params: {
  host: string;
  user: string;
  sshOpts?: string;
  iface: string;
  publicKey: string;
  allowedIpCidr: string; // "10.8.0.10/32"
}) {
  const cmd = `sudo -n wg set ${params.iface} peer ${params.publicKey} allowed-ips ${params.allowedIpCidr}`;
  await sshExec({
    host: params.host,
    user: params.user,
    sshOpts: params.sshOpts,
    cmd,
  });
}

export async function wgRemovePeer(params: {
  host: string;
  user: string;
  sshOpts?: string;
  iface: string;
  publicKey: string;
}) {
  const cmd = `sudo -n wg set ${params.iface} peer ${params.publicKey} remove`;
  await sshExec({
    host: params.host,
    user: params.user,
    sshOpts: params.sshOpts,
    cmd,
  });
}

export async function wgShowPublicKey(params: {
  host: string;
  user: string;
  sshOpts?: string;
  iface: string;
}) {
  const cmd = `sudo -n wg show ${params.iface} public-key`;
  const { stdout } = await sshExec({
    host: params.host,
    user: params.user,
    sshOpts: params.sshOpts,
    cmd,
  });
  return stdout.trim();
}
