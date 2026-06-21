-- Remove the GENTLE persistence level; existing GENTLE reminders become PERSISTENT.
ALTER TYPE "PersistenceLevel" RENAME TO "PersistenceLevel_old";
CREATE TYPE "PersistenceLevel" AS ENUM ('PERSISTENT', 'ALARM');
ALTER TABLE "Reminder" ALTER COLUMN "persistence" DROP DEFAULT;
ALTER TABLE "Reminder" ALTER COLUMN "persistence" TYPE "PersistenceLevel" USING (
  CASE "persistence"::text WHEN 'GENTLE' THEN 'PERSISTENT' ELSE "persistence"::text END::"PersistenceLevel"
);
ALTER TABLE "Reminder" ALTER COLUMN "persistence" SET DEFAULT 'PERSISTENT';
DROP TYPE "PersistenceLevel_old";
