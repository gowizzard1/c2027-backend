-- Weekly mobile-data stipend request workflow
CREATE TABLE "StipendRequest" (
  "id" TEXT NOT NULL,
  "volunteerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "adminNote" TEXT,
  "paymentRef" TEXT,

  CONSTRAINT "StipendRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StipendRequest_volunteerId_requestedAt_idx" ON "StipendRequest"("volunteerId", "requestedAt");
CREATE INDEX "StipendRequest_status_requestedAt_idx" ON "StipendRequest"("status", "requestedAt");
