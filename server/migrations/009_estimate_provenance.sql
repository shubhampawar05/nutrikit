-- Up Migration
-- Estimate provenance (M4). The estimate's own provenance (prompt and calc versions, model version, candidates
-- offered, attempts) lives in the estimate JSON; these columns hold what exists without an estimate, or outside it.
-- estimate_failures: rejected AI answers that left the food without an estimate, newest first, at most 5:
--   [{ at, provider, model, promptVersion, problem }].
-- estimate_reviewed_at: when an operator last approved or rejected the estimate (their reason, if any, is `note`).
ALTER TABLE food_requests ADD COLUMN estimate_failures JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE food_requests ADD COLUMN estimate_reviewed_at TIMESTAMPTZ;

-- Down Migration
ALTER TABLE food_requests DROP COLUMN IF EXISTS estimate_reviewed_at;
ALTER TABLE food_requests DROP COLUMN IF EXISTS estimate_failures;
