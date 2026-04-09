/*
  Warnings:

  - The values [BOT] on the enum `SignUpType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "SignUpType_new" AS ENUM ('USERNAME', 'WECHAT', 'EMAIL');
ALTER TABLE "public"."users" ALTER COLUMN "signUpType" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "signUpType" TYPE "SignUpType_new" USING ("signUpType"::text::"SignUpType_new");
ALTER TYPE "SignUpType" RENAME TO "SignUpType_old";
ALTER TYPE "SignUpType_new" RENAME TO "SignUpType";
DROP TYPE "public"."SignUpType_old";
ALTER TABLE "users" ALTER COLUMN "signUpType" SET DEFAULT 'USERNAME';
COMMIT;

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
