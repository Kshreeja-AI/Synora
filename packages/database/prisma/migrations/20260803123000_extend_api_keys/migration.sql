-- Extend ApiKey with metadata needed to make it usable as a developer credential:
--   createdById  — audit attribution (who provisioned this key)
--   prefix       — non-secret display prefix, unique so the picker can locate a
--                  key without the raw secret
--   revokedAt    — explicit revocation timestamp (auth path treats non-null as
--                  disabled without deleting the row, so audit trail survives)
--
-- Existing rows (none in a fresh DB, but safe if pushed to one) get a
-- deterministic legacy prefix backfilled from their id so the unique
-- constraint holds without touching the secret.

ALTER TABLE "ApiKey"
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "prefix" TEXT,
  ADD COLUMN "revokedAt" TIMESTAMP(3);

UPDATE "ApiKey" SET "prefix" = 'sk_legacy_' || substr("id", 1, 12) WHERE "prefix" IS NULL;

ALTER TABLE "ApiKey" ALTER COLUMN "prefix" SET NOT NULL;
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

ALTER TABLE "ApiKey"
  ADD CONSTRAINT "ApiKey_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL;
