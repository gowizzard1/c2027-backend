-- Anonymous, browser-limited public opinion polls with transparent reset history.
CREATE TABLE "OpinionPoll" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "description" TEXT,
  "disclosure" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpinionPoll_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OpinionPoll_slug_key" ON "OpinionPoll"("slug");
CREATE INDEX "OpinionPoll_status_publishedAt_idx" ON "OpinionPoll"("status", "publishedAt");

CREATE TABLE "OpinionPollOption" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpinionPollOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpinionPollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "OpinionPoll"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OpinionPollOption_pollId_sortOrder_key" ON "OpinionPollOption"("pollId", "sortOrder");
CREATE UNIQUE INDEX "OpinionPollOption_pollId_label_key" ON "OpinionPollOption"("pollId", "label");
CREATE INDEX "OpinionPollOption_pollId_idx" ON "OpinionPollOption"("pollId");

CREATE TABLE "OpinionPollVote" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "pollVersion" INTEGER NOT NULL,
  "browserTokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpinionPollVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpinionPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "OpinionPoll"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OpinionPollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "OpinionPollOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OpinionPollVote_pollId_pollVersion_browserTokenHash_key" ON "OpinionPollVote"("pollId", "pollVersion", "browserTokenHash");
CREATE INDEX "OpinionPollVote_pollId_pollVersion_idx" ON "OpinionPollVote"("pollId", "pollVersion");
CREATE INDEX "OpinionPollVote_optionId_pollVersion_idx" ON "OpinionPollVote"("optionId", "pollVersion");

CREATE TABLE "OpinionPollResetAudit" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "fromVersion" INTEGER NOT NULL,
  "toVersion" INTEGER NOT NULL,
  "note" TEXT NOT NULL,
  "resetBy" TEXT NOT NULL,
  "voteCountBefore" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpinionPollResetAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpinionPollResetAudit_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "OpinionPoll"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OpinionPollResetAudit_pollId_createdAt_idx" ON "OpinionPollResetAudit"("pollId", "createdAt");
