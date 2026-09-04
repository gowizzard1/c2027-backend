-- Volunteer account password (bcrypt hash), set on activation via the invite link
ALTER TABLE "Volunteer" ADD COLUMN "passwordHash" TEXT;
