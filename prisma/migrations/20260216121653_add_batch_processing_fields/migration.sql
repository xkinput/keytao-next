-- AlterTable
ALTER TABLE "sync_tasks" ADD COLUMN     "pendingFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "processedFiles" TEXT[] DEFAULT ARRAY[]::TEXT[];
