-- DropIndex
DROP INDEX "Peer_revokedAt_idx";

-- CreateIndex
CREATE INDEX "Peer_nodeId_allowedIp_idx" ON "Peer"("nodeId", "allowedIp");
