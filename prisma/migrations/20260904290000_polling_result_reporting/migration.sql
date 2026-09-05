-- Private polling-day result reporting and candidate registry
CREATE TABLE "ElectionCandidate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "party" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ElectionCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ElectionCandidate_name_party_key" ON "ElectionCandidate"("name", "party");
CREATE INDEX "ElectionCandidate_active_name_idx" ON "ElectionCandidate"("active", "name");

CREATE TABLE "PollingResultReport" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "pollingStationId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "candidateVotesJson" TEXT NOT NULL,
  "validVotes" INTEGER NOT NULL,
  "rejectedVotes" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "reviewNote" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "PollingResultReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PollingResultReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "VolunteerRoleAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PollingResultReport_pollingStationId_fkey" FOREIGN KEY ("pollingStationId") REFERENCES "PollingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PollingResultReport_assignmentId_revisionNumber_key" ON "PollingResultReport"("assignmentId", "revisionNumber");
CREATE INDEX "PollingResultReport_pollingStationId_submittedAt_idx" ON "PollingResultReport"("pollingStationId", "submittedAt");
CREATE INDEX "PollingResultReport_status_submittedAt_idx" ON "PollingResultReport"("status", "submittedAt");

CREATE TABLE "PollingResultAttachment" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PollingResultAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PollingResultAttachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "PollingResultReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PollingResultAttachment_objectKey_key" ON "PollingResultAttachment"("objectKey");
CREATE INDEX "PollingResultAttachment_reportId_idx" ON "PollingResultAttachment"("reportId");
