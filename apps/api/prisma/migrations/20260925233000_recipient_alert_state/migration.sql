CREATE TABLE "RecipientAlertState" (
    "occurrenceId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "snoozedUntil" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationSilencedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    CONSTRAINT "RecipientAlertState_pkey" PRIMARY KEY ("occurrenceId","recipientId")
);

CREATE INDEX "RecipientAlertState_recipientId_snoozedUntil_idx" ON "RecipientAlertState"("recipientId","snoozedUntil");
CREATE INDEX "RecipientAlertState_snoozedUntil_idx" ON "RecipientAlertState"("snoozedUntil");

ALTER TABLE "RecipientAlertState" ADD CONSTRAINT "RecipientAlertState_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "ReminderOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipientAlertState" ADD CONSTRAINT "RecipientAlertState_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
