-- Rebuild ReminderCategory: NONE replaces CUSTOM and becomes the default; the
-- value order is reworked (none, task, medication, appointment). Any existing
-- CUSTOM rows are remapped to NONE.
ALTER TYPE "ReminderCategory" RENAME TO "ReminderCategory_old";
CREATE TYPE "ReminderCategory" AS ENUM ('NONE', 'TASK', 'MEDICATION', 'APPOINTMENT');
ALTER TABLE "Reminder" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "Reminder" ALTER COLUMN "category" TYPE "ReminderCategory" USING (
  CASE "category"::text WHEN 'CUSTOM' THEN 'NONE' ELSE "category"::text END::"ReminderCategory"
);
ALTER TABLE "Reminder" ALTER COLUMN "category" SET DEFAULT 'NONE';
DROP TYPE "ReminderCategory_old";
