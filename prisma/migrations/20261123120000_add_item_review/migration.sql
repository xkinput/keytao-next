BEGIN;

ALTER TABLE "batches" ADD COLUMN "itemReviewStarted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pull_requests" ADD COLUMN "appliedAt" TIMESTAMP(3);

UPDATE "pull_requests" AS pr
SET "appliedAt" = COALESCE(batch."reviewedAt", pr."updateAt")
FROM "batches" AS batch
WHERE pr."batchId" = batch."id" AND pr."status" = 'Approved';

UPDATE "pull_requests" AS pr
SET "status" = 'Pending'
FROM "batches" AS batch
WHERE pr."batchId" = batch."id" AND batch."status" = 'Submitted' AND pr."status" = 'Rejected';

CREATE TABLE "pull_request_review_notes" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "PullRequestStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "pullRequestId" INTEGER NOT NULL,
    "reviewerId" INTEGER,
    CONSTRAINT "pull_request_review_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pull_request_review_notes_decision_check" CHECK ("decision" IN ('Approved', 'Rejected')),
    CONSTRAINT "pull_request_review_notes_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pull_request_review_notes_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "pull_request_review_notes_pullRequestId_id_idx" ON "pull_request_review_notes"("pullRequestId", "id");
CREATE INDEX "pull_request_review_notes_reviewerId_idx" ON "pull_request_review_notes"("reviewerId");

-- Preserve review invariants while previous application instances are still serving.
CREATE FUNCTION "guard_item_review_batch_transition"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD."itemReviewStarted" AND OLD."status" = 'Submitted' AND NEW."status" <> OLD."status"
        AND (NEW."status" NOT IN ('Approved', 'Rejected') OR NEW."contentVersion" <> OLD."contentVersion" + 1)
    THEN
        RAISE EXCEPTION 'Item review requires a versioned finalization' USING ERRCODE = '23514';
    END IF;
    IF NEW."syncTaskId" IS NOT NULL AND NEW."syncTaskId" IS DISTINCT FROM OLD."syncTaskId"
        AND (NEW."status" <> 'Approved' OR (NEW."itemReviewStarted" AND NEW."contentVersion" <> OLD."contentVersion" + 1))
    THEN
        RAISE EXCEPTION 'Item review requires a versioned sync claim' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "guard_item_review_batch_transition"
BEFORE UPDATE OF "status", "syncTaskId" ON "batches"
FOR EACH ROW EXECUTE FUNCTION "guard_item_review_batch_transition"();

CREATE FUNCTION "normalize_legacy_review_on_submit"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD."status" = 'Rejected' AND NEW."status" = 'Submitted' AND NOT NEW."itemReviewStarted" THEN
        UPDATE "pull_requests" SET "status" = 'Pending'
        WHERE "batchId" = NEW."id" AND "status" = 'Rejected';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "normalize_legacy_review_on_submit"
AFTER UPDATE OF "status" ON "batches"
FOR EACH ROW EXECUTE FUNCTION "normalize_legacy_review_on_submit"();

CREATE FUNCTION "mark_legacy_review_applied"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."status" = 'Approved' AND NEW."appliedAt" IS NULL THEN
        SELECT COALESCE("reviewedAt", NEW."updateAt") INTO NEW."appliedAt"
        FROM "batches" WHERE "id" = NEW."batchId" AND "status" = 'Approved' AND NOT "itemReviewStarted";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "mark_legacy_review_applied"
BEFORE UPDATE OF "status" ON "pull_requests"
FOR EACH ROW EXECUTE FUNCTION "mark_legacy_review_applied"();

COMMIT;
