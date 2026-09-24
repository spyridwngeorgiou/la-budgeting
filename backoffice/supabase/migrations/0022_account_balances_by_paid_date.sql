-- 0022: account balances move on the day cash moved, not the invoice date
--
-- v_account_balances (0011) counted a paid row when tx_date >= the account's
-- opening_balance_date. Two cases break that against the workbook it
-- replaces (Λογαριασμοί!C4:C9):
--   * an instalment due after the snapshot but paid before it (the workbook's
--     «Δόσεις εντός βάσης») is already inside the opening balance, yet its
--     tx_date is later -- it was counted twice;
--   * a row dated on the snapshot day itself is already in the declared
--     balance -- the workbook uses "Ημ/νία Πληρωμής > snapshot", strictly.
-- Both are fixed by keying on the payment date, strictly after the snapshot.
-- Rows with no paid_on (AADE imports may lack it) fall back to tx_date.

create or replace view v_account_balances as
select
  a.id as account_id, a.org_id, a.name, a.kind, a.owner_scope, a.is_liquid,
  a.opening_balance, a.opening_balance_date,
  a.opening_balance + coalesce(sum(t.signed_amount) filter (
    where t.status = 'paid' and coalesce(t.paid_on, t.tx_date) > a.opening_balance_date
  ), 0) as current_balance
from accounts a
left join transactions t on t.account_id = a.id and t.org_id = a.org_id
group by a.id, a.org_id, a.name, a.kind, a.owner_scope, a.is_liquid,
         a.opening_balance, a.opening_balance_date;
