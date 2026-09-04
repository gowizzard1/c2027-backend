-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpCode_contact_createdAt_idx" ON "OtpCode"("contact", "createdAt");
