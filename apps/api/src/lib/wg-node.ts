import { sshExec } from "./ssh";

export async function wgAddPeer(params: { iface: string; publicKey: string; allowedIp: string }) {
  const { iface, publicKey, allowedIp } = params;
  // publicKey from WireGuard is base64 => safe, but still quote it
  const cmd = `sudo -n wg set ${iface} peer '${publicKey}' allowed-ips ${allowedIp}/32`;
  await sshExec(cmd);
}

export async function wgRemovePeer(params: { iface: string; publicKey: string }) {
  const { iface, publicKey } = params;
  const cmd = `sudo -n wg set ${iface} peer '${publicKey}' remove`;
  await sshExec(cmd);
}
