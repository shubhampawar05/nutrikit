-- Up Migration
-- A payment that arrives when it can't change the plan (the team already has that plan with no end date, or a
-- dearer one) is still recorded, with a note for operators saying why the plan was kept; null = applied as bought.
-- period_end then holds the team's unchanged paid-until (or the payment time when the plan has no end date).
ALTER TABLE payments ADD COLUMN note text;

-- Down Migration
ALTER TABLE payments DROP COLUMN IF EXISTS note;
