ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "isAdmin" = true WHERE lower("email") = 'ryan.ewen@gmail.com';

ALTER TABLE "Session"
  ADD COLUMN "clientApp" TEXT,
  ADD COLUMN "clientPlatform" TEXT,
  ADD COLUMN "webVersion" TEXT,
  ADD COLUMN "nativeVersion" TEXT,
  ADD COLUMN "clientReportedAt" TIMESTAMP(3);
CREATE INDEX "Session_lastSeenAt_idx" ON "Session"("lastSeenAt");
