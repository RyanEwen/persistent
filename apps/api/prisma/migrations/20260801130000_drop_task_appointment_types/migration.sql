-- Drop TASK and APPOINTMENT. A reminder type earns its place by selecting extra
-- fields and body text (TODO -> its checklist, MEDICATION -> its doses); these two
-- only ever changed an icon, which is not worth a type. NONE already covers
-- "just remind me", so existing rows of both fall back to it.
--
-- Postgres can't remove a value from an enum in place, so the type is rebuilt and
-- the column re-cast — same approach as 20260620120000_category_none_replaces_custom.
ALTER TYPE "ReminderType" RENAME TO "ReminderType_old";
CREATE TYPE "ReminderType" AS ENUM ('NONE', 'TODO', 'MEDICATION');
ALTER TABLE "Reminder" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Reminder" ALTER COLUMN "type" TYPE "ReminderType" USING (
  CASE "type"::text
    WHEN 'TASK' THEN 'NONE'
    WHEN 'APPOINTMENT' THEN 'NONE'
    ELSE "type"::text
  END::"ReminderType"
);
ALTER TABLE "Reminder" ALTER COLUMN "type" SET DEFAULT 'NONE';
DROP TYPE "ReminderType_old";
