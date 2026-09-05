-- Optional candidate image and reversible archive state
ALTER TABLE "ElectionCandidate"
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "activeBeforeArchive" BOOLEAN;

CREATE INDEX "ElectionCandidate_archivedAt_idx" ON "ElectionCandidate"("archivedAt");
