-- Reversible volunteer archival: preserve prior status and archive timestamp
ALTER TABLE "Volunteer"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "statusBeforeArchive" TEXT;

CREATE INDEX "Volunteer_archivedAt_idx" ON "Volunteer"("archivedAt");
