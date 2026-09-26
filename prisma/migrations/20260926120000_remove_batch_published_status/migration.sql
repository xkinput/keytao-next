-- AlterEnum
BEGIN;
CREATE TYPE "BatchStatus_new" AS ENUM ('Draft', 'Submitted', 'Approved', 'Rejected');
ALTER TABLE "batches" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "batches" ALTER COLUMN "status" TYPE "BatchStatus_new" USING ("status"::text::"BatchStatus_new");
ALTER TYPE "BatchStatus" RENAME TO "BatchStatus_old";
ALTER TYPE "BatchStatus_new" RENAME TO "BatchStatus";
DROP TYPE "BatchStatus_old";
ALTER TABLE "batches" ALTER COLUMN "status" SET DEFAULT 'Draft';
COMMIT;

