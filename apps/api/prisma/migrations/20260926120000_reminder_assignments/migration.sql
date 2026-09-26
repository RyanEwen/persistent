CREATE TYPE "AssignmentState" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED');

CREATE TABLE "ReminderAssignment" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "recipientId" TEXT,
  "recipientEmail" TEXT NOT NULL,
  "reminderId" TEXT,
  "title" TEXT NOT NULL,
  "draft" JSONB,
  "state" "AssignmentState" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "declinedAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  CONSTRAINT "ReminderAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReminderAssignment_reminderId_key" ON "ReminderAssignment"("reminderId");
CREATE INDEX "ReminderAssignment_creatorId_createdAt_idx" ON "ReminderAssignment"("creatorId", "createdAt");
CREATE INDEX "ReminderAssignment_recipientEmail_state_idx" ON "ReminderAssignment"("recipientEmail", "state");
CREATE INDEX "ReminderAssignment_recipientId_state_idx" ON "ReminderAssignment"("recipientId", "state");

ALTER TABLE "ReminderAssignment" ADD CONSTRAINT "ReminderAssignment_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderAssignment" ADD CONSTRAINT "ReminderAssignment_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReminderAssignment" ADD CONSTRAINT "ReminderAssignment_reminderId_fkey"
  FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
