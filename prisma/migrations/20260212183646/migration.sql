-- CreateEnum
CREATE TYPE "SyncTaskStatus" AS ENUM ('Pending', 'Running', 'Completed', 'Failed');

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "syncTaskId" TEXT;

-- CreateTable
CREATE TABLE "sync_tasks" (
    "id" TEXT NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "SyncTaskStatus" NOT NULL DEFAULT 'Pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "githubPrUrl" TEXT,
    "githubPrNumber" INTEGER,
    "githubBranch" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sync_tasks_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_syncTaskId_fkey" FOREIGN KEY ("syncTaskId") REFERENCES "sync_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
