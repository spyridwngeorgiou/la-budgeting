-- 0033: warnings for gaps the ledger can't explain.
--
-- Rather than patching rows until balances "look right" (the workbook's plug
-- figures), the app says out loud where the ledger and reality disagree or
-- where it is blind:
--   v_qc_account_drift              -- the last physical count differs from
--                                      what the ledger computed, or a liquid
--                                      account hasn't been counted in 35 days
--                                      (drift is invisible without a count)
--   v_qc_counterparty_without_contact -- movements naming a counterparty that
--                                      has no contact record, so per-supplier
--                                      history and ΑΦΜ checks can't see them

create view v_qc_account_drift with (security_invoker = true) as
with last_count as (
  select distinct on (account_id)
    account_id, as_of_date, asserted_balance, computed_balance
  from account_balance_assertions
  order by account_id, as_of_date desc
)
select
  a.account_id,
  a.org_id,
  a.name as account_name,
  lc.as_of_date as counted_on,
  lc.asserted_balance as counted_amount,
  lc.computed_balance as computed_amount,
  lc.asserted_balance - lc.computed_balance as drift,
  (current_date - lc.as_of_date) as days_since_count,
  case
    when lc.as_of_date is null then 'never_counted'
    when abs(lc.asserted_balance - lc.computed_balance) >= 1 then 'drift'
    else 'stale'
  end as issue
from v_account_balances a
left join last_count lc on lc.account_id = a.account_id
where a.is_liquid
  and (
    lc.as_of_date is null
    or abs(lc.asserted_balance - lc.computed_balance) >= 1
    or current_date - lc.as_of_date > 35
  );

create view v_qc_counterparty_without_contact with (security_invoker = true) as
select
  t.org_id,
  t.counterparty_name,
  count(*) as n,
  sum(t.gross_amount) as gross_amount,
  max(t.tx_date) as last_tx_date,
  (array_agg(t.id order by t.tx_date desc))[1:50] as transaction_ids
from transactions t
where t.contact_id is null
  and nullif(trim(t.counterparty_name), '') is not null
group by t.org_id, t.counterparty_name;
