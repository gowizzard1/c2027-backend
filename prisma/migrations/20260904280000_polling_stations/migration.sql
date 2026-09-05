-- Official Turbo Constituency polling station registry and polling-agent assignment link
CREATE TABLE "PollingStation" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ward" TEXT NOT NULL,
  "county" TEXT NOT NULL DEFAULT 'Uasin Gishu',
  "constituency" TEXT NOT NULL DEFAULT 'Turbo',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PollingStation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PollingStation_name_ward_key" ON "PollingStation"("name", "ward");
CREATE INDEX "PollingStation_active_ward_idx" ON "PollingStation"("active", "ward");

ALTER TABLE "VolunteerRoleAssignment" ADD COLUMN "pollingStationId" TEXT;
ALTER TABLE "VolunteerRoleAssignment" ADD CONSTRAINT "VolunteerRoleAssignment_pollingStationId_fkey" FOREIGN KEY ("pollingStationId") REFERENCES "PollingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "VolunteerRoleAssignment_pollingStationId_idx" ON "VolunteerRoleAssignment"("pollingStationId");
