-- Security & correctness hardening migration (2026-07-26)
--
-- 1. phrases: relax the (word, code) unique key to (word, code, type) and add
--    lookup indexes on code / (type, code).
-- 2. batches: record who reviewed a batch and when.
-- 3. api_keys: replace the plaintext `key` column with a sha256 `keyHash`
--    plus a short `keyPrefix` used for display only. Existing keys are hashed
--    in place so they keep working; the plaintext column is then dropped.

-- NOTE: `prisma migrate deploy` does NOT wrap a migration file in a
-- transaction on PostgreSQL (verified against prisma 7.8 + postgres 15: a
-- statement failing mid-file leaves the earlier statements committed). This
-- migration performs many dependent DDL steps plus a data backfill, so it
-- wraps itself explicitly — either the whole thing lands or none of it does.
BEGIN;

-- ---------------------------------------------------------------------------
-- phrases: (word, code) -> (word, code, type) + indexes
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "phrases_word_code_key";

CREATE UNIQUE INDEX "phrases_word_code_type_key" ON "phrases"("word", "code", "type");

CREATE INDEX "phrases_code_idx" ON "phrases"("code");

CREATE INDEX "phrases_type_code_idx" ON "phrases"("type", "code");

-- ---------------------------------------------------------------------------
-- batches: reviewer bookkeeping
-- ---------------------------------------------------------------------------
ALTER TABLE "batches" ADD COLUMN "reviewerId" INTEGER;
ALTER TABLE "batches" ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "batches_reviewerId_idx" ON "batches"("reviewerId");

ALTER TABLE "batches"
  ADD CONSTRAINT "batches_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- api_keys: plaintext key -> sha256 hash + display prefix
-- ---------------------------------------------------------------------------
ALTER TABLE "api_keys" ADD COLUMN "keyHash" TEXT;
ALTER TABLE "api_keys" ADD COLUMN "keyPrefix" TEXT;

-- Backfill from the existing plaintext column. `sha256()` is a PostgreSQL 11+
-- builtin, so no pgcrypto extension is required. The digest must match the
-- application side: sha256(utf8 bytes of the key), lowercase hex.
UPDATE "api_keys"
SET "keyHash" = encode(sha256(convert_to("key", 'UTF8')), 'hex'),
    "keyPrefix" = left("key", 8);

-- Defensive: any row that somehow has no plaintext key cannot be recovered,
-- so give it an unusable placeholder hash instead of failing the migration.
UPDATE "api_keys"
SET "keyHash" = 'disabled-' || "id"::text,
    "keyPrefix" = 'disabled',
    "enabled" = false
WHERE "keyHash" IS NULL;

ALTER TABLE "api_keys" ALTER COLUMN "keyHash" SET NOT NULL;
ALTER TABLE "api_keys" ALTER COLUMN "keyPrefix" SET NOT NULL;

DROP INDEX IF EXISTS "api_keys_key_key";

CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

ALTER TABLE "api_keys" DROP COLUMN "key";

COMMIT;
