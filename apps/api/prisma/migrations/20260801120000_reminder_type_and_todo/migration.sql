-- "Category" becomes "type" — a reminder's kind now also selects behavior (TODO
-- carries a checklist), so the name tracks the function. Columns and the enum are
-- renamed in place; existing rows keep their values.
ALTER TYPE "ReminderCategory" RENAME TO "ReminderType";
ALTER TABLE "Reminder" RENAME COLUMN "category" TO "type";
ALTER TABLE "Reminder" RENAME COLUMN "categoryData" TO "typeData";

-- TODO: a single reminder covering several items, confirmed off one firing.
-- Added after TASK so the picker order stays none, task-shaped, then the rest.
ALTER TYPE "ReminderType" ADD VALUE 'TODO' AFTER 'TASK';

-- Which checklist items THIS firing has ticked off. Per-occurrence, so a repeating
-- checklist starts each firing blank. Ticking every item does not acknowledge the
-- occurrence — only Done does.
ALTER TABLE "ReminderOccurrence" ADD COLUMN     "checkedItems" JSONB NOT NULL DEFAULT '[]';
