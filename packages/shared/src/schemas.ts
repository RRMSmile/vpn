import { z } from "zod";

export const EmailSchema = z.string().email();

export const AuthRequestSchema = z.object({ email: EmailSchema });
export const AuthConsumeSchema = z.object({ token: z.string().min(10) });

export const ServerCreateSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUser: z.string().min(1).default("root"),
  wgInterface: z.string().min(1).default("wg0"),
  endpointHost: z.string().min(1),
  endpointPort: z.number().int().min(1).max(65535).default(51820),
  dns: z.string().min(1).default("1.1.1.1,8.8.8.8"),
  allowedIps: z.string().min(1).default("0.0.0.0/0, ::/0")
});

export const VpnIssueSchema = z.object({
  serverId: z.string().min(1),
  deviceName: z.string().min(1).max(64).default("device")
});

export const VpnRevokeSchema = z.object({
  peerId: z.string().min(1)
});