-- Reversible private archive for polling result reports
ALTER TABLE "PollingResultReport"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archiveNote" TEXT,
  ADD COLUMN "archivedBy" TEXT;

CREATE INDEX "PollingResultReport_archivedAt_idx" ON "PollingResultReport"("archivedAt");
