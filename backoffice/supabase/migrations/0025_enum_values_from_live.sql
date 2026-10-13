-- 0025: enum values the live/staging database already uses but no migration
-- in this repository defines (they came with Spyros' newer, unpushed code).
-- Needed so data copied from staging loads: categories marked as loan
-- principal or equity, and ledger rows that arrived by e-mail.

alter type cost_treatment add value if not exists 'principal';
alter type cost_treatment add value if not exists 'equity';
alter type tx_origin add value if not exists 'ai_email';
