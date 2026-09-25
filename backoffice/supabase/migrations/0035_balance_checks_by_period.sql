-- 0035: balance checks answer "are we missing movements, and how much?"
--
-- A check (account_balance_assertions) is: on date D the account really held
-- R. The question it must answer is whether the movements recorded for the
-- period leading up to D explain R -- and if not, how much is missing.
--
--   start (previous check's real balance, or the opening balance, or a date
--          the user picks)  + income recorded  - expenses recorded
--   = what the app expects on D;   R - expected = the gap for that period
--
-- Computed LIVE, not snapshotted: once the missing movement is recorded the
-- gap shrinks and the warning goes away. (0023 snapshotted computed_balance
-- so a gap stayed forever even after it was fixed -- still stored for
-- history, no longer used for warnings.)

alter table account_balance_assertions add column period_start date;

comment on column account_balance_assertions.period_start is
  'Start of the period this check covers, if the user chose one. NULL = since the previous check, or since the opening balance.';

create function public.balance_check_breakdown(p_account uuid, p_as_of date, p_from date default null)
returns table (
  period_start date,
  period_start_balance numeric,
  period_start_source text,        -- 'check' | 'opening' | 'app'
  period_income numeric,
  period_expense numeric,
  period_income_n int,
  period_expense_n int,
  expected_balance numeric
)
language plpgsql stable security invoker set search_path = public as $$
declare
  a accounts%rowtype;
  prev account_balance_assertions%rowtype;
  s_date date;
  s_bal numeric;
  s_src text;
begin
  select * into a from accounts where id = p_account;

  if p_from is null then
    select * into prev from account_balance_assertions
      where account_id = p_account and as_of_date < p_as_of
      order by as_of_date desc limit 1;
    if found then
      s_date := prev.as_of_date; s_bal := prev.asserted_balance; s_src := 'check';
    else
      s_date := a.opening_balance_date; s_bal := a.opening_balance; s_src := 'opening';
    end if;
  else
    select * into prev from account_balance_assertions where account_id = p_account and as_of_date = p_from;
    if found then
      s_date := p_from; s_bal := prev.asserted_balance; s_src := 'check';
    elsif p_from <= a.opening_balance_date then
      s_date := a.opening_balance_date; s_bal := a.opening_balance; s_src := 'opening';
    else
      -- No real balance known on that date: start from what the app itself
      -- computed then, and say so (source 'app'), since that start may be wrong too.
      s_date := p_from; s_bal := account_balance_as_of(p_account, p_from); s_src := 'app';
    end if;
  end if;

  return query
  select
    s_date, s_bal, s_src,
    coalesce(sum(t.gross_amount) filter (where t.direction = 'income'), 0),
    coalesce(sum(t.gross_amount) filter (where t.direction = 'expense'), 0),
    (count(*) filter (where t.direction = 'income'))::int,
    (count(*) filter (where t.direction = 'expense'))::int,
    s_bal + coalesce(sum(t.signed_amount), 0)
  from transactions t
  where t.account_id = p_account
    and t.status = 'paid'
    and t.tx_date >= a.opening_balance_date
    and coalesce(t.paid_on, t.tx_date) <= p_as_of
    and (s_src = 'opening' or coalesce(t.paid_on, t.tx_date) > s_date);
end
$$;

create view v_balance_checks with (security_invoker = true) as
select
  b.id,
  b.account_id,
  b.org_id,
  b.as_of_date,
  b.asserted_balance,
  (b.created_by is null) as from_import,
  br.period_start,
  br.period_start_balance,
  br.period_start_source,
  br.period_income,
  br.period_expense,
  br.period_income_n,
  br.period_expense_n,
  br.expected_balance,
  b.asserted_balance - br.expected_balance as period_gap,
  b.asserted_balance - account_balance_as_of(b.account_id, b.as_of_date) as total_gap
from account_balance_assertions b
cross join lateral balance_check_breakdown(b.account_id, b.as_of_date, b.period_start) br;

-- Warnings now use the LIVE gap of the latest check, so fixing the ledger
-- clears them. Same columns as 0033.
drop view v_qc_account_drift;
create view v_qc_account_drift with (security_invoker = true) as
with last_check as (
  select distinct on (account_id) account_id, as_of_date, asserted_balance
  from account_balance_assertions
  order by account_id, as_of_date desc
)
select
  a.account_id,
  a.org_id,
  a.name as account_name,
  lc.as_of_date as counted_on,
  lc.asserted_balance as counted_amount,
  account_balance_as_of(a.account_id, lc.as_of_date) as computed_amount,
  lc.asserted_balance - account_balance_as_of(a.account_id, lc.as_of_date) as drift,
  (current_date - lc.as_of_date) as days_since_count,
  case
    when lc.as_of_date is null then 'never_counted'
    when abs(lc.asserted_balance - account_balance_as_of(a.account_id, lc.as_of_date)) >= 1 then 'drift'
    else 'stale'
  end as issue
from v_account_balances a
left join last_check lc on lc.account_id = a.account_id
where a.is_liquid
  and (
    lc.as_of_date is null
    or abs(lc.asserted_balance - account_balance_as_of(a.account_id, lc.as_of_date)) >= 1
    or current_date - lc.as_of_date > 35
  );
