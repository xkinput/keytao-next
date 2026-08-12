BEGIN;

CREATE TABLE IF NOT EXISTS "bot_evidence_cache" (
  "sourceId" TEXT NOT NULL,
  "word" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "text" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bot_evidence_cache_pkey" PRIMARY KEY ("sourceId", "word")
);

COMMIT;
