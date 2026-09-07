-- Auditable administrator-triggered pledge email attempts.
CREATE TABLE "PledgeEmailDelivery" (
  "id" TEXT NOT NULL,
  "pledgeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'sending',
  "recipientEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "initiatedBy" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PledgeEmailDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PledgeEmailDelivery_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "Pledge"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PledgeEmailDelivery_pledgeId_createdAt_idx" ON "PledgeEmailDelivery"("pledgeId", "createdAt");
CREATE INDEX "PledgeEmailDelivery_kind_status_createdAt_idx" ON "PledgeEmailDelivery"("kind", "status", "createdAt");
