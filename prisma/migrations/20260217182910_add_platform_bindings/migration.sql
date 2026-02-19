/*
  Warnings:

  - A unique constraint covering the columns `[qqId]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[telegramId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "SignUpType" ADD VALUE 'BOT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "qqId" TEXT,
ADD COLUMN     "telegramId" TEXT;

-- CreateTable
CREATE TABLE "link_keys" (
    "id" TEXT NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "platform" TEXT,
    "platformId" TEXT,

    CONSTRAINT "link_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "link_keys_userId_idx" ON "link_keys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "users_qqId_key" ON "users"("qqId");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");

-- AddForeignKey
ALTER TABLE "link_keys" ADD CONSTRAINT "link_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
