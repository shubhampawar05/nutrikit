-- Up Migration
-- Application store: developer accounts, sessions, API keys, metering, upgrade requests,
-- the barcode cache, and the state that must be shared between app instances.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE accounts (
  id            text PRIMARY KEY,
  email         citext NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,                  -- scrypt$<salt hex>$<hash hex>
  plan          text NOT NULL DEFAULT 'free',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id_hash    text PRIMARY KEY,                  -- SHA-256 of the cookie value
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);

CREATE TABLE api_keys (
  id           text PRIMARY KEY,
  key_hash     text NOT NULL UNIQUE,            -- SHA-256 of the nk_ key
  name         text NOT NULL,
  token_limit  bigint,                          -- monthly allowance for operator keys; NULL = plan/unlimited
  account_id   text REFERENCES accounts(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  last_used_at timestamptz
);
CREATE INDEX api_keys_account ON api_keys(account_id);

-- key_id has no foreign key: calls made with auth disabled are recorded under the key id 'dev'.
CREATE TABLE usage (
  id         bigserial PRIMARY KEY,
  key_id     text NOT NULL,
  account_id text REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  tokens     integer NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_key_at ON usage(key_id, at);
CREATE INDEX usage_account_at ON usage(account_id, at);

CREATE TABLE upgrade_requests (
  id         bigserial PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plan       text NOT NULL,
  message    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE barcode_cache (
  code       text PRIMARY KEY,
  payload    jsonb,                             -- product, or NULL for a confirmed miss
  fetched_at timestamptz NOT NULL
);

CREATE TABLE meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- Per-minute rate limits: one row per bucket (account, key or demo IP). The window starts at the
-- first request and lasts one minute; see auth.rateLimit.
CREATE TABLE rate_windows (
  bucket       text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL
);

-- Failed portal logins, for throttling (5 per 15 minutes per email).
CREATE TABLE login_failures (
  email citext NOT NULL,
  at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_failures_email_at ON login_failures(email, at);

-- Down Migration
DROP TABLE IF EXISTS login_failures, rate_windows, meta, barcode_cache, upgrade_requests, usage, api_keys, sessions, accounts;
