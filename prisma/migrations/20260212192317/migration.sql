/*
  Warnings:

  - The values [Sentence,Poem,Other] on the enum `PhraseType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PhraseType_new" AS ENUM ('Single', 'Phrase', 'Supplement', 'Symbol', 'Link', 'CSS', 'CSSSingle', 'English');
ALTER TABLE "public"."phrases" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "phrases" ALTER COLUMN "type" TYPE "PhraseType_new" USING ("type"::text::"PhraseType_new");
ALTER TABLE "pull_requests" ALTER COLUMN "type" TYPE "PhraseType_new" USING ("type"::text::"PhraseType_new");
ALTER TYPE "PhraseType" RENAME TO "PhraseType_old";
ALTER TYPE "PhraseType_new" RENAME TO "PhraseType";
DROP TYPE "public"."PhraseType_old";
ALTER TABLE "phrases" ALTER COLUMN "type" SET DEFAULT 'Phrase';
COMMIT;
