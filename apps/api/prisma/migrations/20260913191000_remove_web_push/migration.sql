-- Browser notifications are no longer supported. Remove their subscriptions
-- and the VAPID key store, then narrow the push target model to native FCM.
DELETE FROM "PushSubscription" WHERE "kind" = 'WEB';

ALTER TABLE "PushSubscription" DROP COLUMN "keys";
DROP TABLE "Setting";

CREATE TYPE "PushKind_new" AS ENUM ('FCM');
ALTER TABLE "PushSubscription"
  ALTER COLUMN "kind" TYPE "PushKind_new"
  USING ("kind"::text::"PushKind_new");
ALTER TYPE "PushKind" RENAME TO "PushKind_old";
ALTER TYPE "PushKind_new" RENAME TO "PushKind";
DROP TYPE "PushKind_old";
