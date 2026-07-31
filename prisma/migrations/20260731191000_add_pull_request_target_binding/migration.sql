BEGIN;

ALTER TABLE "pull_requests"
  ADD COLUMN IF NOT EXISTS "targetPhraseId" INTEGER,
  ADD COLUMN IF NOT EXISTS "needsManualReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "targetFingerprint" TEXT;

UPDATE "pull_requests"
SET "targetPhraseId" = "phraseId"
WHERE "targetPhraseId" IS NULL
  AND "phraseId" IS NOT NULL
  AND "action" IN ('Change', 'Delete');

UPDATE "pull_requests"
SET "needsManualReview" = true
WHERE "action" IN ('Change', 'Delete')
  AND "targetFingerprint" IS NULL;

COMMIT;
