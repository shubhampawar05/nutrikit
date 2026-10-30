-- Up Migration
-- Paid plans are 30-day periods bought with one-time Razorpay payments.
-- plan_expires_at: when the paid period ends (null = no end: Free, or a plan set by an operator).
ALTER TABLE accounts ADD COLUMN plan_expires_at timestamptz;

-- Every applied payment, once (the primary key makes browser confirmation and webhook idempotent).
CREATE TABLE payments (
  payment_id text PRIMARY KEY,
  order_id   text NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plan       text NOT NULL,
  amount     integer NOT NULL,              -- paise
  currency   text NOT NULL,
  period_end timestamptz NOT NULL,          -- the account's paid-until after this payment
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_account ON payments(account_id, created_at);

-- Down Migration
DROP TABLE IF EXISTS payments;
ALTER TABLE accounts DROP COLUMN IF EXISTS plan_expires_at;
