-- Up Migration
-- Foods people tried to log that the catalog could not match, counted, so the catalog grows from real misses.
-- Only the food words are kept (no account, key, IP or request details). An AI estimate for the food may be stored
-- with it; once an operator approves it, it is used for that food without calling the AI again.
CREATE TABLE food_requests (
  id BIGSERIAL PRIMARY KEY,
  phrase TEXT NOT NULL UNIQUE,              -- the food words, normalized: "sabudana khichdi"
  example TEXT NOT NULL,                    -- the first input seen for it: "2 bowls sabudana khichdi"
  reason TEXT NOT NULL,                     -- why it was unmatched, the last time
  count INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  note TEXT,
  estimate JSONB,                           -- { name, per100g, serving: { label, unit, grams }, provider, model, at }
  estimate_status TEXT NOT NULL DEFAULT 'none' CHECK (estimate_status IN ('none', 'pending', 'approved', 'rejected')),
  estimate_uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX food_requests_by_status ON food_requests (status, count DESC);

-- Down Migration
DROP TABLE food_requests;
