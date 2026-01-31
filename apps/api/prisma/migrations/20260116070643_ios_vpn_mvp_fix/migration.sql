/*
  Warnings:

  - The primary key for the `MagicToken` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `MagicToken` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `VpnNode` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VpnPeer` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userId,deviceId]` on the table `Device` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `name` to the `Device` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Device" DROP CONSTRAINT "Device_userId_fkey";

-- DropForeignKey
ALTER TABLE "VpnPeer" DROP CONSTRAINT "VpnPeer_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "VpnPeer" DROP CONSTRAINT "VpnPeer_nodeId_fkey";

-- DropForeignKey
ALTER TABLE "VpnPeer" DROP CONSTRAINT "VpnPeer_userId_fkey";

-- DropIndex
DROP INDEX "Device_deviceId_key";

-- DropIndex
DROP INDEX "MagicToken_tokenHash_key";

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "name" TEXT NOT NULL,
ALTER COLUMN "platform" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MagicToken" DROP CONSTRAINT "MagicToken_pkey",
DROP COLUMN "id",
ADD CONSTRAINT "MagicToken_pkey" PRIMARY KEY ("tokenHash");

-- AlterTable
ALTER TABLE "User" DROP COLUMN "updatedAt";

-- DropTable
DROP TABLE "VpnNode";

-- DropTable
DROP TABLE "VpnPeer";

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sshHost" TEXT NOT NULL,
    "sshUser" TEXT NOT NULL,
    "wgInterface" TEXT NOT NULL DEFAULT 'wg0',
    "wgPort" INTEGER NOT NULL DEFAULT 51820,
    "endpointHost" TEXT NOT NULL,
    "serverPublicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Peer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "allowedIp" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Peer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Peer_userId_idx" ON "Peer"("userId");

-- CreateIndex
CREATE INDEX "Peer_deviceId_idx" ON "Peer"("deviceId");

-- CreateIndex
CREATE INDEX "Peer_nodeId_idx" ON "Peer"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Peer_nodeId_publicKey_key" ON "Peer"("nodeId", "publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Peer_nodeId_allowedIp_key" ON "Peer"("nodeId", "allowedIp");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_deviceId_key" ON "Device"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "MagicToken_expiresAt_idx" ON "MagicToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Peer" ADD CONSTRAINT "Peer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Peer" ADD CONSTRAINT "Peer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Peer" ADD CONSTRAINT "Peer_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
