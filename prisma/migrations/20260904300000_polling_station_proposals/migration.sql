-- Station proposals from polling-agent applicants require explicit admin approval
ALTER TABLE "PollingStation"
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN "proposedByEmail" TEXT,
  ADD COLUMN "proposedAt" TIMESTAMP(3);

CREATE INDEX "PollingStation_approvalStatus_active_idx" ON "PollingStation"("approvalStatus", "active");
