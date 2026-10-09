CREATE TABLE "AnnouncementView" (
  "userId" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementView_pkey" PRIMARY KEY ("userId", "announcementId")
);

ALTER TABLE "AnnouncementView" ADD CONSTRAINT "AnnouncementView_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
