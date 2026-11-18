-- Up Migration
-- Teams. An `accounts` row is now a team: it keeps the plan, keys, usage and payments. The person who signs in is a
-- `users` row, and belongs to teams through `memberships`. Every existing account becomes a team owned by its person
-- (same email, password and verification), so existing sessions, keys and payments keep working.

CREATE TABLE users (
  id                text PRIMARY KEY,               -- usr_<hex>
  email             citext NOT NULL UNIQUE,
  name              text NOT NULL,
  password_hash     text NOT NULL,                  -- scrypt$<salt hex>$<hash hex>
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users (id, email, name, password_hash, email_verified_at, created_at)
SELECT 'usr_' || substring(id FROM 6), email, name, password_hash, email_verified_at, created_at FROM accounts;

CREATE TABLE memberships (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'developer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

INSERT INTO memberships (account_id, user_id, role, created_at)
SELECT id, 'usr_' || substring(id FROM 6), 'owner', created_at FROM accounts;

-- Invitations by email. Only a SHA-256 of the link's token is stored.
CREATE TABLE invitations (
  id_hash     text PRIMARY KEY,
  account_id  text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'developer')),
  invited_by  text REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_account ON invitations(account_id);

-- Invitations sent, for throttling per team (NUTRIKIT_INVITE_LIMIT per hour); rows older than an hour are pruned.
CREATE TABLE invite_sends (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invite_sends_account_at ON invite_sends(account_id, at);

-- Sessions belong to a user; account_id is the team in use (falls back to another membership when it goes away).
ALTER TABLE sessions ADD COLUMN user_id text REFERENCES users(id) ON DELETE CASCADE;
UPDATE sessions SET user_id = 'usr_' || substring(account_id FROM 6);
ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE sessions DROP CONSTRAINT sessions_account_id_fkey;
ALTER TABLE sessions ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
CREATE INDEX sessions_user ON sessions(user_id);

-- Email links (verification, password reset) belong to the user.
ALTER TABLE email_tokens ADD COLUMN user_id text REFERENCES users(id) ON DELETE CASCADE;
UPDATE email_tokens SET user_id = 'usr_' || substring(account_id FROM 6);
ALTER TABLE email_tokens ALTER COLUMN user_id SET NOT NULL;
DROP INDEX email_tokens_account;
ALTER TABLE email_tokens DROP COLUMN account_id;
CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);

-- Keys are live or test, and remember who made them (kept when that person leaves).
ALTER TABLE api_keys ADD COLUMN mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'test'));
ALTER TABLE api_keys ADD COLUMN created_by text REFERENCES users(id) ON DELETE SET NULL;
UPDATE api_keys SET created_by = 'usr_' || substring(account_id FROM 6) WHERE account_id IS NOT NULL;

-- Login data now lives on users.
ALTER TABLE accounts DROP COLUMN email;
ALTER TABLE accounts DROP COLUMN password_hash;
ALTER TABLE accounts DROP COLUMN email_verified_at;

-- Down Migration
-- Each team gets back the login of its oldest owner. Teams without an owner, test keys, invitations and non-owner
-- memberships are dropped; sessions of other users end.
ALTER TABLE accounts ADD COLUMN email citext;
ALTER TABLE accounts ADD COLUMN password_hash text;
ALTER TABLE accounts ADD COLUMN email_verified_at timestamptz;
UPDATE accounts a SET email = u.email, password_hash = u.password_hash, email_verified_at = u.email_verified_at
FROM (
  SELECT DISTINCT ON (u.email) m.account_id, u.email, u.password_hash, u.email_verified_at
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.role = 'owner'
  ORDER BY u.email, m.created_at
) u
WHERE u.account_id = a.id;
DELETE FROM accounts WHERE email IS NULL;
ALTER TABLE accounts ALTER COLUMN email SET NOT NULL;
ALTER TABLE accounts ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT accounts_email_key UNIQUE (email);

DELETE FROM api_keys WHERE mode = 'test';
ALTER TABLE api_keys DROP COLUMN created_by;
ALTER TABLE api_keys DROP COLUMN mode;

ALTER TABLE email_tokens ADD COLUMN account_id text;
UPDATE email_tokens t SET account_id = a.id FROM users u JOIN accounts a ON a.email = u.email WHERE u.id = t.user_id;
DELETE FROM email_tokens WHERE account_id IS NULL;
ALTER TABLE email_tokens ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
DROP INDEX email_tokens_user;
ALTER TABLE email_tokens DROP COLUMN user_id;
CREATE INDEX email_tokens_account ON email_tokens(account_id, purpose);

DELETE FROM sessions s USING users u WHERE u.id = s.user_id
  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.email = u.email);
UPDATE sessions s SET account_id = a.id FROM users u JOIN accounts a ON a.email = u.email WHERE u.id = s.user_id;
DROP INDEX sessions_user;
ALTER TABLE sessions DROP COLUMN user_id;
ALTER TABLE sessions DROP CONSTRAINT sessions_account_id_fkey;
ALTER TABLE sessions ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

DROP TABLE IF EXISTS invite_sends, invitations, memberships, users;
