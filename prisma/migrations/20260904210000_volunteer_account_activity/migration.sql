-- Volunteer account/invite activity for admin support visibility
ALTER TABLE "Volunteer"
  ADD COLUMN "inviteDeliveryStatus" TEXT NOT NULL DEFAULT 'not_sent',
  ADD COLUMN "inviteSentAt" TIMESTAMP(3),
  ADD COLUMN "inviteFailedAt" TIMESTAMP(3),
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginFailedAt" TIMESTAMP(3),
  ADD COLUMN "loginFailureCount" INTEGER NOT NULL DEFAULT 0;
