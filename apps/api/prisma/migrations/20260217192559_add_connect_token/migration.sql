-- CreateTable
CREATE TABLE "ConnectToken" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectToken_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "ConnectToken_userId_idx" ON "ConnectToken"("userId");

-- CreateIndex
CREATE INDEX "ConnectToken_deviceId_idx" ON "ConnectToken"("deviceId");

-- CreateIndex
CREATE INDEX "ConnectToken_expiresAt_idx" ON "ConnectToken"("expiresAt");
