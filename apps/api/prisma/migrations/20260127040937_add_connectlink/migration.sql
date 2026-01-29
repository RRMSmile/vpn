-- CreateTable
CREATE TABLE "ConnectLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boundPublicKey" TEXT,
    "peerId" TEXT,

    CONSTRAINT "ConnectLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectLink_token_key" ON "ConnectLink"("token");

-- CreateIndex
CREATE INDEX "ConnectLink_expiresAt_idx" ON "ConnectLink"("expiresAt");

-- CreateIndex
CREATE INDEX "ConnectLink_token_idx" ON "ConnectLink"("token");

-- CreateIndex
CREATE INDEX "ConnectLink_boundPublicKey_idx" ON "ConnectLink"("boundPublicKey");
