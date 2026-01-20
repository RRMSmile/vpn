import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.upsert({
    where: { code: "basic" },
    update: { title: "Basic", priceKopeks: 29900, durationDays: 30, deviceLimit: 1, isActive: true },
    create: { code: "basic", title: "Basic", priceKopeks: 29900, durationDays: 30, deviceLimit: 1, isActive: true },
  });

  await prisma.plan.upsert({
    where: { code: "pro" },
    update: { title: "Pro", priceKopeks: 49900, durationDays: 30, deviceLimit: 3, isActive: true },
    create: { code: "pro", title: "Pro", priceKopeks: 49900, durationDays: 30, deviceLimit: 3, isActive: true },
  });

  console.log("seed ok");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
