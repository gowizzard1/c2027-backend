-- Scheduled poll closure and idempotent News publication reference.
ALTER TABLE "OpinionPoll"
  ADD COLUMN "closesAt" TIMESTAMP(3),
  ADD COLUMN "closedBy" TEXT,
  ADD COLUMN "resultsNewsId" TEXT;

CREATE UNIQUE INDEX "OpinionPoll_resultsNewsId_key" ON "OpinionPoll"("resultsNewsId");
CREATE INDEX "OpinionPoll_status_closesAt_idx" ON "OpinionPoll"("status", "closesAt");
