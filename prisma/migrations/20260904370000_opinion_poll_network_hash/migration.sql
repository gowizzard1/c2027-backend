-- Anonymous network-level duplicate protection for opinion polls.
-- Legacy votes remain NULL and are preserved without storing any raw IP address.
ALTER TABLE "OpinionPollVote" ADD COLUMN "networkHash" TEXT;
CREATE UNIQUE INDEX "OpinionPollVote_pollId_pollVersion_networkHash_key" ON "OpinionPollVote"("pollId", "pollVersion", "networkHash");
