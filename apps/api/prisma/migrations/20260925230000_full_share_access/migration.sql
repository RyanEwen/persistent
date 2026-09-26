UPDATE "ReminderShare" SET "permission" = 'EDIT' WHERE "permission" <> 'EDIT';
UPDATE "ReminderInvitation" SET "permission" = 'EDIT' WHERE "permission" <> 'EDIT';

ALTER TABLE "ReminderShare" ALTER COLUMN "permission" SET DEFAULT 'EDIT';
ALTER TABLE "ReminderInvitation" ALTER COLUMN "permission" SET DEFAULT 'EDIT';
