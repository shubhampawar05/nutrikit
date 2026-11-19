-- Read-only: how many stored AI estimates the M4/M5 deploy could re-estimate, and how many are likely to be used.
-- Safe to run before deploying (it needs no column added by migrations 009 or 010).
--   pending_total         pending estimates (only these are ever re-estimated automatically)
--   pending_legacy        pending ones made before provenance: each is re-estimated once, on its next AI-enabled use
--   pending_over_30_days  pending ones also older than 30 days
--   legacy_seen_30d       legacy pending foods someone tried to log in the last 30 days (a realistic first-month figure)
--   legacy_seen_7d        the same for the last 7 days (roughly the first week)
--   approved / rejected   never re-estimated automatically
SELECT
  count(*) FILTER (WHERE estimate_status = 'pending' AND estimate IS NOT NULL)                                          AS pending_total,
  count(*) FILTER (WHERE estimate_status = 'pending' AND estimate IS NOT NULL AND estimate->>'promptVersion' IS NULL)   AS pending_legacy,
  count(*) FILTER (WHERE estimate_status = 'pending' AND estimate IS NOT NULL AND (estimate->>'at')::timestamptz < now() - interval '30 days') AS pending_over_30_days,
  count(*) FILTER (WHERE estimate_status = 'pending' AND estimate IS NOT NULL AND estimate->>'promptVersion' IS NULL AND last_seen > now() - interval '30 days') AS legacy_seen_30d,
  count(*) FILTER (WHERE estimate_status = 'pending' AND estimate IS NOT NULL AND estimate->>'promptVersion' IS NULL AND last_seen > now() - interval '7 days')  AS legacy_seen_7d,
  count(*) FILTER (WHERE estimate_status = 'approved')                                                                  AS approved,
  count(*) FILTER (WHERE estimate_status = 'rejected')                                                                  AS rejected
FROM food_requests;
