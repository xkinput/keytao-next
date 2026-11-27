BEGIN;

CREATE OR REPLACE FUNCTION "guard_item_review_batch_transition"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD."itemReviewStarted" AND OLD."status" = 'Submitted' AND NEW."status" <> OLD."status"
        AND NOT (
            NEW."status" = 'Draft'
            AND NOT NEW."itemReviewStarted"
            AND NEW."contentVersion" = OLD."contentVersion" + 1
            AND OLD."reviewerId" IS NULL
            AND OLD."reviewedAt" IS NULL
            AND OLD."syncTaskId" IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM "pull_requests" pr
                WHERE pr."batchId" = OLD."id"
                  AND (pr."appliedAt" IS NOT NULL OR pr."status" = 'Rejected')
            )
            AND NOT EXISTS (
                SELECT 1 FROM "pull_request_review_notes" note
                JOIN "pull_requests" pr ON pr."id" = note."pullRequestId"
                WHERE pr."batchId" = OLD."id"
                  AND (
                      note."reviewerId" IS NOT NULL
                      OR note."decision" <> 'Approved'
                      OR note."reason" <> '本喵根据逐条审核记录标记通过'
                  )
            )
        )
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

COMMIT;
