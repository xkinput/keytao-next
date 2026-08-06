BEGIN;

CREATE TABLE IF NOT EXISTS "zdic_pinyin_cache" (
  "kind" TEXT NOT NULL,
  "entry" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "pinyins" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "zdic_pinyin_cache_pkey" PRIMARY KEY ("kind", "entry")
);

COMMIT;
