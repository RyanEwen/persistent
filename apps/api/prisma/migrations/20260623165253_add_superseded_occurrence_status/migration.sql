-- AlterEnum
ALTER TYPE "OccurrenceStatus" ADD VALUE 'SUPERSEDED';

-- AlterTable
ALTER TABLE "ReminderOccurrence" ADD COLUMN     "supersededAt" TIMESTAMP(3);
