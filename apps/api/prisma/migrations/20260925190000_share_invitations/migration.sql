CREATE TABLE "ReminderInvitation" (
    "reminderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReminderInvitation_pkey" PRIMARY KEY ("reminderId","email")
);

CREATE INDEX "ReminderInvitation_email_idx" ON "ReminderInvitation"("email");

ALTER TABLE "ReminderInvitation" ADD CONSTRAINT "ReminderInvitation_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ShareRecipient" (
    "ownerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "lastSharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareRecipient_pkey" PRIMARY KEY ("ownerId","email")
);

CREATE INDEX "ShareRecipient_ownerId_lastSharedAt_idx" ON "ShareRecipient"("ownerId","lastSharedAt");

ALTER TABLE "ShareRecipient" ADD CONSTRAINT "ShareRecipient_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
