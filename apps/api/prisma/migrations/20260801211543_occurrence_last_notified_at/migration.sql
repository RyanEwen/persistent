-- When the server last put this occurrence in front of the user (fire, snooze
-- revival, escalation). `firedAt` stays pinned to the first fire because the
-- escalation backstop is anchored to it, so it can't double as "most recent".
-- AlterTable
ALTER TABLE "ReminderOccurrence" ADD COLUMN     "lastNotifiedAt" TIMESTAMP(3);

-- Backfill: for everything that has already fired, the first fire is the best
-- (and only) record we have of when it was last shown. Existing rows therefore
-- sort exactly as they did before this column existed, rather than all collapsing
-- to null and falling back to scheduledFor.
UPDATE "ReminderOccurrence" SET "lastNotifiedAt" = "firedAt" WHERE "firedAt" IS NOT NULL;
