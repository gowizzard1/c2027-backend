-- Centrally managed candidate race labels. Existing candidate race strings are
-- preserved and seeded as selectable registry entries.
CREATE TABLE "CandidateRace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CandidateRace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CandidateRace_name_key" ON "CandidateRace"("name");
CREATE INDEX "CandidateRace_active_name_idx" ON "CandidateRace"("active", "name");

INSERT INTO "CandidateRace" ("id", "name", "active", "createdAt", "updatedAt")
VALUES ('race_unassigned', 'Unassigned', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "CandidateRace" ("id", "name", "active", "createdAt", "updatedAt")
SELECT 'race_' || md5("race"), "race", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "race" FROM "ElectionCandidate" WHERE "race" IS NOT NULL AND "race" <> '') AS existing_races
ON CONFLICT ("name") DO NOTHING;
