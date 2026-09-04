-- Add secret toolkit access token to Volunteer
ALTER TABLE "Volunteer" ADD COLUMN "accessToken" TEXT;
CREATE UNIQUE INDEX "Volunteer_accessToken_key" ON "Volunteer"("accessToken");

-- Drop the OTP table (OTP login was replaced by the secret access-link approach)
DROP TABLE IF EXISTS "OtpCode";
