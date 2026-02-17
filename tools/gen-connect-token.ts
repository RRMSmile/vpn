import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

type Args = {
  userId: string;
  deviceId: string;
  ttlSeconds: number;
};

function usage(): never {
  console.error(
    [
      "Usage:",
      "  tsx tools/gen-connect-token.ts --userId <value> --deviceId <uuid> --ttl <seconds>",
      "",
      "Example:",
      "  tsx tools/gen-connect-token.ts --userId tg:999 --deviceId 11111111-2222-3333-4444-555555555555 --ttl 3600",
    ].join("\n")
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (!key.startsWith("--")) continue;
    if (!value || value.startsWith("--")) usage();

    if (key === "--userId") out.userId = value;
    if (key === "--deviceId") out.deviceId = value;
    if (key === "--ttl") out.ttlSeconds = Number(value);

    i++;
  }

  if (!out.userId || !out.deviceId || !out.ttlSeconds || !Number.isFinite(out.ttlSeconds)) {
    usage();
  }

  if (out.ttlSeconds <= 0) {
    throw new Error("--ttl must be > 0");
  }

  return out as Args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000);

    await prisma.connectToken.create({
      data: {
        token,
        userId: args.userId,
        deviceId: args.deviceId,
        expiresAt,
      },
    });

    console.log(`token=${token}`);
    console.log(`expiresAt=${expiresAt.toISOString()}`);
    console.log(`deepLink=safevpn://connect/${token}`);
    console.log(`provisionPath=/v1/connect/${token}/provision`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
