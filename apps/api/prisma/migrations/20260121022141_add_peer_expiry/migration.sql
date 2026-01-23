-- AlterTable
ALTER TABLE "Peer" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Peer_expiresAt_idx" ON "Peer"("expiresAt");

-- CreateIndex
CREATE INDEX "Peer_revokedAt_idx" ON "Peer"("revokedAt");
