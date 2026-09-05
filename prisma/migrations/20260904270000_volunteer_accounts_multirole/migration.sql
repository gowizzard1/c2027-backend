-- Additive multi-role volunteer account migration.
-- Legacy Volunteer rows are intentionally preserved for audit/rollback compatibility.

CREATE TABLE "VolunteerAccount" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "idNumber" TEXT NOT NULL,
  "passwordHash" TEXT,
  "accessToken" TEXT,
  "inviteDeliveryStatus" TEXT NOT NULL DEFAULT 'not_sent',
  "inviteSentAt" TIMESTAMP(3),
  "inviteFailedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "lastLoginFailedAt" TIMESTAMP(3),
  "loginFailureCount" INTEGER NOT NULL DEFAULT 0,
  "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VolunteerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VolunteerAccount_emailNormalized_key" ON "VolunteerAccount"("emailNormalized");
CREATE UNIQUE INDEX "VolunteerAccount_accessToken_key" ON "VolunteerAccount"("accessToken");
CREATE INDEX "VolunteerAccount_email_idx" ON "VolunteerAccount"("email");

CREATE TABLE "VolunteerRoleAssignment" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "experience" TEXT,
  "county" TEXT NOT NULL,
  "constituency" TEXT NOT NULL,
  "ward" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "approvedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "statusBeforeArchive" TEXT,
  "sourceVolunteerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VolunteerRoleAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VolunteerRoleAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "VolunteerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VolunteerRoleAssignment_accountId_role_key" ON "VolunteerRoleAssignment"("accountId", "role");
CREATE UNIQUE INDEX "VolunteerRoleAssignment_sourceVolunteerId_key" ON "VolunteerRoleAssignment"("sourceVolunteerId");
CREATE INDEX "VolunteerRoleAssignment_status_idx" ON "VolunteerRoleAssignment"("status");
CREATE INDEX "VolunteerRoleAssignment_role_idx" ON "VolunteerRoleAssignment"("role");
CREATE INDEX "VolunteerRoleAssignment_county_idx" ON "VolunteerRoleAssignment"("county");

-- Choose one canonical legacy Volunteer row per normalized email as the account/credential source.
-- Prefer an activated row, then the most recently updated row.
WITH ranked_accounts AS (
  SELECT v.*, lower(trim(v."email")) AS normalized_email,
         ROW_NUMBER() OVER (
           PARTITION BY lower(trim(v."email"))
           ORDER BY (v."passwordHash" IS NOT NULL) DESC, v."updatedAt" DESC, v."createdAt" DESC
         ) AS account_rank
  FROM "Volunteer" v
)
INSERT INTO "VolunteerAccount" (
  "id", "email", "emailNormalized", "name", "phone", "idNumber", "passwordHash", "accessToken",
  "inviteDeliveryStatus", "inviteSentAt", "inviteFailedAt", "activatedAt", "lastLoginAt", "lastLoginFailedAt",
  "loginFailureCount", "createdAt", "updatedAt"
)
SELECT
  "id", "email", normalized_email, "name", "phone", "idNumber", "passwordHash", "accessToken",
  "inviteDeliveryStatus", "inviteSentAt", "inviteFailedAt", "activatedAt", "lastLoginAt", "lastLoginFailedAt",
  "loginFailureCount", "createdAt", "updatedAt"
FROM ranked_accounts
WHERE account_rank = 1;

-- Create one assignment for each distinct normalized-email/role pair.
-- If historical duplicate role registrations exist, the same canonical selection rule applies;
-- unselected legacy rows remain preserved in Volunteer for audit.
WITH ranked_roles AS (
  SELECT v.*, lower(trim(v."email")) AS normalized_email,
         ROW_NUMBER() OVER (
           PARTITION BY lower(trim(v."email")), v."role"
           ORDER BY (v."passwordHash" IS NOT NULL) DESC, v."updatedAt" DESC, v."createdAt" DESC
         ) AS role_rank
  FROM "Volunteer" v
)
INSERT INTO "VolunteerRoleAssignment" (
  "id", "accountId", "role", "experience", "county", "constituency", "ward", "status",
  "approvedAt", "archivedAt", "statusBeforeArchive", "sourceVolunteerId", "createdAt", "updatedAt"
)
SELECT
  r."id", a."id", r."role", r."experience", r."county", r."constituency", r."ward", r."status",
  r."approvedAt", r."archivedAt", r."statusBeforeArchive", r."id", r."createdAt", r."updatedAt"
FROM ranked_roles r
JOIN "VolunteerAccount" a ON a."emailNormalized" = r.normalized_email
WHERE r.role_rank = 1;

-- Add new ownership columns to existing activity/payment tables without deleting legacy columns.
ALTER TABLE "StipendRequest" ADD COLUMN "accountId" TEXT;
ALTER TABLE "MobilizerReport" ADD COLUMN "assignmentId" TEXT;

-- Stipends belong to the person/account, regardless of role.
UPDATE "StipendRequest" sr
SET "accountId" = a."id"
FROM "Volunteer" v
JOIN "VolunteerAccount" a ON a."emailNormalized" = lower(trim(v."email"))
WHERE sr."volunteerId" = v."id";

-- Mobilizer reports belong to the canonical mobilizer assignment for that account.
UPDATE "MobilizerReport" mr
SET "assignmentId" = assignment."id"
FROM "Volunteer" legacy
JOIN "VolunteerAccount" account ON account."emailNormalized" = lower(trim(legacy."email"))
JOIN "VolunteerRoleAssignment" assignment ON assignment."accountId" = account."id" AND assignment."role" = legacy."role"
WHERE mr."volunteerId" = legacy."id";

ALTER TABLE "StipendRequest" ADD CONSTRAINT "StipendRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "VolunteerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MobilizerReport" ADD CONSTRAINT "MobilizerReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "VolunteerRoleAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "StipendRequest_accountId_requestedAt_idx" ON "StipendRequest"("accountId", "requestedAt");
CREATE UNIQUE INDEX "MobilizerReport_assignmentId_periodStart_key" ON "MobilizerReport"("assignmentId", "periodStart");
CREATE INDEX "MobilizerReport_assignmentId_periodStart_idx" ON "MobilizerReport"("assignmentId", "periodStart");
