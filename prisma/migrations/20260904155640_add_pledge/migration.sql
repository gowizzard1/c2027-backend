-- CreateTable
CREATE TABLE "Pledge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pledge_status_createdAt_idx" ON "Pledge"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Pledge_phone_idx" ON "Pledge"("phone");

-- CreateIndex
CREATE INDEX "Pledge_email_idx" ON "Pledge"("email");
