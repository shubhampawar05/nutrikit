-- Up Migration
-- Email verification and password reset. Existing accounts start unverified; verification is not required to
-- use the API (the dashboard asks for it).
ALTER TABLE accounts ADD COLUMN email_verified_at timestamptz;

-- One-time links sent by email. Only a SHA-256 of the link's token is stored, like sessions and API keys.
-- `email` is the address the link went to: a verification link only verifies that address.
CREATE TABLE email_tokens (
  id_hash    text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  email      citext NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_account ON email_tokens(account_id, purpose);

-- Emails sent, for throttling (per address and per client address); rows older than a day are pruned.
CREATE TABLE email_sends (
  email   citext NOT NULL,
  ip      inet,
  purpose text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_sends_email_at ON email_sends(email, at);
CREATE INDEX email_sends_ip_at ON email_sends(ip, at);

-- Down Migration
DROP TABLE IF EXISTS email_sends, email_tokens;
ALTER TABLE accounts DROP COLUMN IF EXISTS email_verified_at;
