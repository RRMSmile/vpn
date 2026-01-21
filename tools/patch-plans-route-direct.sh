#!/usr/bin/env bash
set -euo pipefail

FILE="apps/api/src/routes/plans.ts"
if [[ ! -f "$FILE" ]]; then
  echo "ERROR: $FILE not found. List routes:"
  ls -la apps/api/src/routes
  exit 1
fi

# ВАЖНО: поправь импорт prisma ниже, если у тебя другой файл
# Пример: import { prisma } from "../db";
# или:    import { prisma } from "../prisma";
PRISMA_IMPORT_LINE='import { prisma } from "../db";'

cat > "$FILE" <<TS
import { FastifyInstance } from "fastify";
${PRISMA_IMPORT_LINE}

export async function plansRoutes(app: FastifyInstance) {
  app.get("/v1/plans", async () => {
    // прямой источник правды: таблица Plan
    const plans = await prisma.plan.findMany({
      orderBy: { sort: "asc" as any },
    });

    return { items: plans, total: plans.length };
  });
}
TS

echo "OK: patched $FILE"
echo "NOTE: if prisma import path is wrong, edit PRISMA_IMPORT_LINE in tools/patch-plans-route-direct.sh"
