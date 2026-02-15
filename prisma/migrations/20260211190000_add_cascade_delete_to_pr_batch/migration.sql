-- DropForeignKey
ALTER TABLE "pull_requests" DROP CONSTRAINT "pull_requests_batchId_fkey";

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
