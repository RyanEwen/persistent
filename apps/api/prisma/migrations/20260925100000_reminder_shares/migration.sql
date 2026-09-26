CREATE TYPE "SharePermission" AS ENUM ('VIEW', 'ACT', 'EDIT');

CREATE TABLE "ReminderShare" (
    "reminderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderShare_pkey" PRIMARY KEY ("reminderId","recipientId")
);

CREATE INDEX "ReminderShare_recipientId_idx" ON "ReminderShare"("recipientId");

ALTER TABLE "ReminderShare" ADD CONSTRAINT "ReminderShare_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderShare" ADD CONSTRAINT "ReminderShare_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
