-- CreateTable
CREATE TABLE "user_dictionary_entries" (
    "id" SERIAL NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateAt" TIMESTAMP(3) NOT NULL,
    "word" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PhraseType" NOT NULL DEFAULT 'Phrase',
    "weight" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "replacePublic" BOOLEAN NOT NULL DEFAULT true,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "user_dictionary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_dictionary_entries_userId_word_code_type_key" ON "user_dictionary_entries"("userId", "word", "code", "type");

-- CreateIndex
CREATE INDEX "user_dictionary_entries_userId_idx" ON "user_dictionary_entries"("userId");

-- CreateIndex
CREATE INDEX "user_dictionary_entries_userId_code_idx" ON "user_dictionary_entries"("userId", "code");

-- CreateIndex
CREATE INDEX "user_dictionary_entries_userId_word_type_idx" ON "user_dictionary_entries"("userId", "word", "type");

-- AddForeignKey
ALTER TABLE "user_dictionary_entries" ADD CONSTRAINT "user_dictionary_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
