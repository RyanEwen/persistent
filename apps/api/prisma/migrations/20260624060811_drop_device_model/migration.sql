/*
  Warnings:

  - You are about to drop the column `deviceId` on the `PushSubscription` table. All the data in the column will be lost.
  - You are about to drop the `Device` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Device" DROP CONSTRAINT "Device_userId_fkey";

-- DropForeignKey
ALTER TABLE "PushSubscription" DROP CONSTRAINT "PushSubscription_deviceId_fkey";

-- AlterTable
ALTER TABLE "PushSubscription" DROP COLUMN "deviceId";

-- DropTable
DROP TABLE "Device";

-- DropEnum
DROP TYPE "DevicePlatform";
