-- Escalation is now always an alarm: drop the contact-email + own-devices toggle
-- and add an optional absolute escalation time ("HH:mm").
ALTER TABLE "Reminder" DROP COLUMN "escalateContactEmail";
ALTER TABLE "Reminder" DROP COLUMN "escalateToOwnDevices";
ALTER TABLE "Reminder" ADD COLUMN "escalateAtTime" TEXT;
