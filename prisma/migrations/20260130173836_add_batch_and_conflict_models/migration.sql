-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('Draft', 'Submitted', 'Approved', 'Rejected', 'Published');

-- AlterTable
ALTER TABLE "pull_requests" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "conflictReason" TEXT,
ADD COLUMN     "hasConflict" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'Draft',
    "creatorId" INTEGER NOT NULL,
    "issueId" INTEGER,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_request_dependencies" (
    "id" SERIAL NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "dependentId" INTEGER NOT NULL,
    "dependsOnId" INTEGER NOT NULL,

    CONSTRAINT "pull_request_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_conflicts" (
    "id" SERIAL NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "code" TEXT NOT NULL,
    "currentWord" TEXT,
    "proposedWord" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "pullRequestId" INTEGER NOT NULL,

    CONSTRAINT "code_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pull_request_dependencies_dependentId_dependsOnId_key" ON "pull_request_dependencies"("dependentId", "dependsOnId");

-- CreateIndex
CREATE INDEX "pull_requests_batchId_idx" ON "pull_requests"("batchId");

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_request_dependencies" ADD CONSTRAINT "pull_request_dependencies_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_request_dependencies" ADD CONSTRAINT "pull_request_dependencies_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_conflicts" ADD CONSTRAINT "code_conflicts_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
