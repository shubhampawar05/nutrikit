-- Up Migration
-- Accounts can be deleted by their owner. Payment records are kept for tax and accounting, detached from the
-- deleted account: the amount, plan and Razorpay ids stay, and nothing that identifies the person does.
ALTER TABLE payments ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE payments DROP CONSTRAINT payments_account_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

-- Down Migration
DELETE FROM payments WHERE account_id IS NULL;
ALTER TABLE payments DROP CONSTRAINT payments_account_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE payments ALTER COLUMN account_id SET NOT NULL;
