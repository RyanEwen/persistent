-- CreateEnum
CREATE TYPE "ShadeProminence" AS ENUM ('INHERIT', 'NORMAL', 'MINIMIZED');

-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "shadeProminence" "ShadeProminence" NOT NULL DEFAULT 'INHERIT';
