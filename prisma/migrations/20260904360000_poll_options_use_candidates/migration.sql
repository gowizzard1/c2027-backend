-- Candidate-backed poll options retain candidate display snapshots for historical results.
ALTER TABLE "OpinionPollOption"
  ADD COLUMN "candidateId" TEXT,
  ADD COLUMN "candidateNameSnapshot" TEXT,
  ADD COLUMN "candidatePartySnapshot" TEXT,
  ADD COLUMN "candidateImageUrlSnapshot" TEXT;

-- Preserve legacy options rather than guessing a registry candidate from a name alone.
UPDATE "OpinionPollOption"
SET "candidateNameSnapshot" = "label"
WHERE "candidateNameSnapshot" IS NULL;

ALTER TABLE "OpinionPollOption"
  ALTER COLUMN "candidateNameSnapshot" SET NOT NULL,
  DROP COLUMN "label";

DROP INDEX IF EXISTS "OpinionPollOption_pollId_label_key";
CREATE UNIQUE INDEX "OpinionPollOption_pollId_candidateId_key" ON "OpinionPollOption"("pollId", "candidateId");
CREATE INDEX "OpinionPollOption_candidateId_idx" ON "OpinionPollOption"("candidateId");

ALTER TABLE "OpinionPollOption"
  ADD CONSTRAINT "OpinionPollOption_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "ElectionCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
