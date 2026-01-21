import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export default fp(async (fastify) => {
  const prisma = new PrismaClient();
  await prisma.$connect();

  fastify.decorate("prisma", prisma);

  // корректное закрытие соединений при остановке сервера
  fastify.addHook("onClose", async (instance) => {
    await instance.prisma.$disconnect();
  });
});
