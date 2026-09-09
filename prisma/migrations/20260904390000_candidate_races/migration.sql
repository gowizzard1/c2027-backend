-- Group candidates and candidate-backed polls by election race.
-- Existing registry data mixes offices, so it is deliberately classified as
-- Unassigned until an administrator assigns the correct race.
ALTER TABLE "ElectionCandidate" ADD COLUMN "race" TEXT NOT NULL DEFAULT 'Unassigned';
ALTER TABLE "OpinionPoll" ADD COLUMN "race" TEXT NOT NULL DEFAULT 'Unassigned';
CREATE INDEX "ElectionCandidate_race_active_idx" ON "ElectionCandidate"("race", "active");
