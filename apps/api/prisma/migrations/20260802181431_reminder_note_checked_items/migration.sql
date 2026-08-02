-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "checkedItems" JSONB NOT NULL DEFAULT '[]';
