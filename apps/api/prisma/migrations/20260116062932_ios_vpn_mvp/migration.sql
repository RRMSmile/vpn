-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpnNode" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 51820,
    "interface" TEXT NOT NULL DEFAULT 'wg0',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpnNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpnPeer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "allowedIp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpnPeer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceId_key" ON "Device"("deviceId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "VpnNode_isActive_idx" ON "VpnNode"("isActive");

-- CreateIndex
CREATE INDEX "VpnPeer_userId_idx" ON "VpnPeer"("userId");

-- CreateIndex
CREATE INDEX "VpnPeer_deviceId_idx" ON "VpnPeer"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "VpnPeer_nodeId_publicKey_key" ON "VpnPeer"("nodeId", "publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "VpnPeer_nodeId_allowedIp_key" ON "VpnPeer"("nodeId", "allowedIp");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpnPeer" ADD CONSTRAINT "VpnPeer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpnPeer" ADD CONSTRAINT "VpnPeer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpnPeer" ADD CONSTRAINT "VpnPeer_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "VpnNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
