/*
  Warnings:

  - A unique constraint covering the columns `[key]` on the table `link_keys` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `key` to the `link_keys` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "link_keys" ADD COLUMN     "key" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "link_keys_key_key" ON "link_keys"("key");
