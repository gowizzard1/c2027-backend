-- Track when a volunteer becomes active/approved for initial stipend eligibility
ALTER TABLE "Volunteer" ADD COLUMN "approvedAt" TIMESTAMP(3);
CREATE INDEX "Volunteer_approvedAt_idx" ON "Volunteer"("approvedAt");
