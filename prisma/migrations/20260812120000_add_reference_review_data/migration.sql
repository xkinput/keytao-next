BEGIN;

CREATE TABLE IF NOT EXISTS "pronunciation_references" (
  "word" TEXT NOT NULL,
  "reading" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  CONSTRAINT "pronunciation_references_pkey" PRIMARY KEY ("word", "reading", "source")
);

CREATE INDEX IF NOT EXISTS "pronunciation_references_word_idx"
  ON "pronunciation_references" ("word");

CREATE TABLE IF NOT EXISTS "corpus_frequencies" (
  "word" TEXT NOT NULL,
  "frequency" INTEGER NOT NULL CHECK ("frequency" >= 0),
  CONSTRAINT "corpus_frequencies_pkey" PRIMARY KEY ("word")
);

COMMIT;
