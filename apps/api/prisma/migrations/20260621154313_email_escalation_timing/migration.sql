-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "escalateEmailAfterMinutes" INTEGER;

-- AlterTable
ALTER TABLE "ReminderOccurrence" ADD COLUMN     "escalationEmailedAt" TIMESTAMP(3);
