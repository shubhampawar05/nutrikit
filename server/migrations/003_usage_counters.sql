-- Up Migration
-- Monthly allowance counters: one row per subject and month, reserved and settled atomically by the metering
-- (auth.reserve / auth.settle), so concurrent calls can't overspend and no request sums `usage`.
-- subject is 'acct:<account id>' (an account's keys share its allowance) or 'key:<key id>' (operator keys).
-- `usage` stays the per-call history; `npm run usage:reconcile` rebuilds a month's counters from it.
CREATE TABLE usage_periods (
  subject      text NOT NULL,
  period_start date NOT NULL,                    -- first day of the UTC month
  used         bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, period_start)
);

INSERT INTO usage_periods (subject, period_start, used)
SELECT CASE WHEN account_id IS NOT NULL THEN 'acct:' || account_id ELSE 'key:' || key_id END,
       date_trunc('month', at AT TIME ZONE 'UTC')::date,
       SUM(tokens)
FROM usage
GROUP BY 1, 2;

-- Signups per client address, for throttling (NUTRIKIT_SIGNUP_LIMIT per hour). Invalid attempts count too.
CREATE TABLE signup_attempts (
  ip inet NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signup_attempts_ip_at ON signup_attempts(ip, at);

-- Failed logins are also throttled per client address (NUTRIKIT_LOGIN_IP_LIMIT per 15 minutes).
ALTER TABLE login_failures ADD COLUMN ip inet;
CREATE INDEX login_failures_ip_at ON login_failures(ip, at);

-- Down Migration
DROP INDEX IF EXISTS login_failures_ip_at;
ALTER TABLE login_failures DROP COLUMN IF EXISTS ip;
DROP TABLE IF EXISTS signup_attempts, usage_periods;
