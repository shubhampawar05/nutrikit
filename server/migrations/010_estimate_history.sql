-- Up Migration
-- Re-estimating stale pending estimates (M5).
-- estimate_history: the estimates this one replaced, newest first, at most 5:
--   [{ estimate, provider, model, promptVersion, calcVersion, estimatedAt, replacedAt, reason }].
-- reestimate_claimed_at: set by the one request re-estimating this food right now (an atomic claim), cleared when it
--   finishes; a claim older than a few minutes is treated as abandoned.
-- reestimate_after: after a failed re-estimate, the food is not tried again before this time, so a failing or
--   rate-limited provider is not asked on every request. The current estimate keeps being served meanwhile.
ALTER TABLE food_requests ADD COLUMN estimate_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE food_requests ADD COLUMN reestimate_claimed_at TIMESTAMPTZ;
ALTER TABLE food_requests ADD COLUMN reestimate_after TIMESTAMPTZ;

-- Down Migration
ALTER TABLE food_requests DROP COLUMN IF EXISTS reestimate_after;
ALTER TABLE food_requests DROP COLUMN IF EXISTS reestimate_claimed_at;
ALTER TABLE food_requests DROP COLUMN IF EXISTS estimate_history;
