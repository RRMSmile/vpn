-- Ensure there is no full unique on (nodeId, allowedIp)
ALTER TABLE "Peer" DROP CONSTRAINT IF EXISTS "Peer_nodeId_allowedIp_key";
DROP INDEX IF EXISTS "Peer_nodeId_allowedIp_key";

-- Active-only uniqueness: only one active peer per (nodeId, allowedIp)
CREATE UNIQUE INDEX IF NOT EXISTS "Peer_nodeId_allowedIp_active_key"
ON "Peer" ("nodeId", "allowedIp")
WHERE "revokedAt" IS NULL;
