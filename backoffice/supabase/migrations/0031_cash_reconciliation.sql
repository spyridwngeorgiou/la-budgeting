-- 0031: balance as of a date, and "what should be in hand now".
--
-- account_balance_assertions (0023) snapshots computed_balance, but the app
-- was snapshotting TODAY's balance even for a count dated in the past -- so
-- a count entered two days late compared against the wrong number. This
-- function computes the balance as of the count's own date.
--
-- v_cash_since_last_count mirrors the workbook's Πληρωμές «Διαδρομή
-- μετρητών»: last physical count, plus business and personal movements
-- paid since, = what should physically be there now. (The workbook's own
-- formula filtered on the due date instead of the payment date; this uses
-- the payment date.)

create function public.account_balance_as_of(p_account uuid, p_date date)
returns numeric
language sql stable security invoker set search_path = public as $$
  select a.opening_balance + coalesce(sum(t.signed_amount) filter (
    where t.status = 'paid'
      and t.tx_date >= a.opening_balance_date
      and coalesce(t.paid_on, t.tx_date) <= p_date
  ), 0)
  from accounts a
  left join transactions t on t.account_id = a.id and t.org_id = a.org_id
  where a.id = p_account
  group by a.id, a.opening_balance
$$;

create view v_cash_since_last_count with (security_invoker = true) as
with last_count as (
  select distinct on (account_id)
    account_id, org_id, as_of_date, asserted_balance, computed_balance
  from account_balance_assertions
  order by account_id, as_of_date desc
)
select
  lc.account_id,
  lc.org_id,
  a.name as account_name,
  a.kind as account_kind,
  lc.as_of_date as counted_on,
  lc.asserted_balance as counted_amount,
  lc.asserted_balance - lc.computed_balance as drift_at_count,
  coalesce(sum(t.signed_amount) filter (where t.scope = 'business'), 0) as business_since,
  coalesce(sum(t.signed_amount) filter (where t.scope = 'personal'), 0) as personal_since,
  lc.asserted_balance + coalesce(sum(t.signed_amount), 0) as expected_now
from last_count lc
join accounts a on a.id = lc.account_id
left join transactions t
  on t.account_id = lc.account_id
 and t.status = 'paid'
 and coalesce(t.paid_on, t.tx_date) > lc.as_of_date
group by lc.account_id, lc.org_id, a.name, a.kind, lc.as_of_date, lc.asserted_balance, lc.computed_balance;
