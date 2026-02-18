import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

type Args = {
  userId: string;
  deviceId: string;
  ttlSeconds: number;
  asJson: boolean;
};

function usage(): never {
  console.error(
    [
      "Usage:",
      "  tsx tools/gen-connect-token.ts --userId <value> --deviceId <uuid> --ttl <seconds> [--json]",
      "",
      "Example:",
      "  tsx tools/gen-connect-token.ts --userId tg:999 --deviceId 11111111-2222-3333-4444-555555555555 --ttl 3600",
      "  tsx tools/gen-connect-token.ts --userId tg:999 --deviceId 11111111-2222-3333-4444-555555555555 --ttl 3600 --json",
    ].join("\n")
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];

    if (!key.startsWith("--")) continue;
    if (key === "--json") {
      out.asJson = true;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) usage();

    if (key === "--userId") out.userId = value;
    if (key === "--deviceId") out.deviceId = value;
    if (key === "--ttl") out.ttlSeconds = Number(value);

    i++;
  }

  if (!out.userId || !out.deviceId || !out.ttlSeconds || !Number.isFinite(out.ttlSeconds)) {
    usage();
  }
  if (out.asJson === undefined) {
    out.asJson = false;
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

    const deepLink = `safevpn://connect/${token}`;

    if (args.asJson) {
      console.log(
        JSON.stringify(
          {
            token,
            deepLink,
            expiresAt: expiresAt.toISOString(),
          },
          null,
          2
        )
      );
    } else {
      console.log(`token=${token}`);
      console.log(`expiresAt=${expiresAt.toISOString()}`);
      console.log(`deepLink=${deepLink}`);
      console.log(`provisionPath=/v1/connect/${token}/provision`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
