-- Mobile app release distribution records
CREATE TABLE "MobileAppRelease" (
  "id" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "version" TEXT NOT NULL,
  "buildNumber" TEXT,
  "fileUrl" TEXT,
  "externalUrl" TEXT,
  "releaseNotes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MobileAppRelease_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MobileAppRelease_platform_active_idx" ON "MobileAppRelease"("platform", "active");
CREATE INDEX "MobileAppRelease_archivedAt_idx" ON "MobileAppRelease"("archivedAt");
