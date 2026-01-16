import { z } from "zod";
import { prisma } from "./prisma";
import { allocateIp } from "./ip-pool";
import { wgSetPeer, wgRemovePeer } from "./wg-node";
import { env } from "../env";

export const ProvisionInputSchema = z.object({
  deviceId: z.string().min(3),
  deviceName: z.string().min(1).max(64).optional(),
  clientPublicKey: z.string().min(20),
});
export type ProvisionInput = z.infer<typeof ProvisionInputSchema>;

function buildConfigTemplate(params: {
  addressIp: string; // "10.8.0.10"
  dns: string;
  serverPublicKey: string;
  endpointHost: string;
  endpointPort: number;
}) {
  const { addressIp, dns, serverPublicKey, endpointHost, endpointPort } = params;

  return [
    `[Interface]`,
    `PrivateKey = {{CLIENT_PRIVATE_KEY}}`,
    `Address = ${addressIp}/32`,
    `DNS = ${dns}`,
    ``,
    `[Peer]`,
    `PublicKey = ${serverPublicKey}`,
    `Endpoint = ${endpointHost}:${endpointPort}`,
    `AllowedIPs = 0.0.0.0/0`,
    `PersistentKeepalive = 25`,
    ``,
  ].join("\n");
}

export async function provisionIosPeer(userId: string, input: ProvisionInput) {
  const device = await prisma.device.upsert({
    where: { userId_deviceId: { userId, deviceId: input.deviceId } },
    create: {
      userId,
      deviceId: input.deviceId,
      name: input.deviceName ?? input.deviceId,
      platform: "ios",
    },
    update: {
      name: input.deviceName ?? input.deviceId,
    },
  });

  // MVP: одна нода
  const node = await prisma.node.upsert({
    where: { id: "wg-node-1" },
    create: {
      id: "wg-node-1",
      name: "wg-node-1",
      sshHost: env.WG_NODE_SSH_HOST,
      sshUser: env.WG_NODE_SSH_USER,
      wgInterface: env.WG_INTERFACE,
      wgPort: env.WG_SERVER_PORT,
      endpointHost: env.WG_NODE_SSH_HOST, // для MVP считаем что endpoint = host
      serverPublicKey: env.WG_SERVER_PUBLIC_KEY,
    },
    update: {
      sshHost: env.WG_NODE_SSH_HOST,
      sshUser: env.WG_NODE_SSH_USER,
      wgInterface: env.WG_INTERFACE,
      wgPort: env.WG_SERVER_PORT,
      endpointHost: env.WG_NODE_SSH_HOST,
      serverPublicKey: env.WG_SERVER_PUBLIC_KEY,
    },
  });

  // Если уже есть активный peer для device, возвращаем его (idempotent)
  const existing = await prisma.peer.findFirst({
    where: { userId, deviceId: device.id, revokedAt: null },
  });
  if (existing) {
    return {
      peer: existing,
      configTemplate: buildConfigTemplate({
        addressIp: existing.allowedIp,
        dns: env.WG_CLIENT_DNS,
        serverPublicKey: node.serverPublicKey,
        endpointHost: node.endpointHost,
        endpointPort: node.wgPort,
      }),
    };
  }

  const ip = await allocateIp({
    prisma,
    startIp: env.WG_POOL_START,
    endIp: env.WG_POOL_END,
  });

  const peer = await prisma.peer.create({
    data: {
      userId,
      deviceId: device.id,
      nodeId: node.id,
      publicKey: input.clientPublicKey,
      allowedIp: ip,
    },
  });

  // Применяем на WG-ноде
  await wgSetPeer({
    host: node.sshHost,
    user: node.sshUser,
    sshOpts: env.WG_NODE_SSH_OPTS,
    iface: node.wgInterface,
    publicKey: peer.publicKey,
    allowedIpCidr: `${peer.allowedIp}/32`,
  });

  return {
    peer,
    configTemplate: buildConfigTemplate({
      addressIp: peer.allowedIp,
      dns: env.WG_CLIENT_DNS,
      serverPublicKey: node.serverPublicKey,
      endpointHost: node.endpointHost,
      endpointPort: node.wgPort,
    }),
  };
}

export async function revokePeer(userId: string, peerId: string) {
  const peer = await prisma.peer.findFirst({ where: { id: peerId, userId } });
  if (!peer) throw new Error("peer_not_found");

  if (peer.revokedAt) return { ok: true };

  const node = await prisma.node.findUnique({ where: { id: peer.nodeId } });
  if (!node) throw new Error("node_not_found");

  await wgRemovePeer({
    host: node.sshHost,
    user: node.sshUser,
    sshOpts: env.WG_NODE_SSH_OPTS,
    iface: node.wgInterface,
    publicKey: peer.publicKey,
  });

  await prisma.peer.update({
    where: { id: peer.id },
    data: { revokedAt: new Date() },
  });

  return { ok: true };
}
