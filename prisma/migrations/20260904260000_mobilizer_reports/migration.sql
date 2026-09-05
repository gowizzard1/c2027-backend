-- Aggregate weekly mobilizer activity reports
CREATE TABLE "MobilizerReport" (
  "id" TEXT NOT NULL,
  "volunteerId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "peopleReached" INTEGER NOT NULL DEFAULT 0,
  "meetingsHeld" INTEGER NOT NULL DEFAULT 0,
  "newVolunteers" INTEGER NOT NULL DEFAULT 0,
  "keyIssues" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "adminNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MobilizerReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobilizerReport_volunteerId_periodStart_key" ON "MobilizerReport"("volunteerId", "periodStart");
CREATE INDEX "MobilizerReport_status_createdAt_idx" ON "MobilizerReport"("status", "createdAt");
CREATE INDEX "MobilizerReport_periodStart_idx" ON "MobilizerReport"("periodStart");
