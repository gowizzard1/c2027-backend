-- One active public poll can be selected as the default /polls experience.
ALTER TABLE "OpinionPoll" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "OpinionPoll_single_default_key" ON "OpinionPoll"("isDefault") WHERE "isDefault" = true;
