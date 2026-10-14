-- 0097: the cash forecast split into banks and cash in hand.
--
-- cash_forecast() runs one balance over every liquid account, so a month in
-- which the notes run out (payments marked to the «Μετρητά» account) hides
-- behind a healthy bank balance. Owner's call (14/10/2026): show the two
-- balances side by side on /reports/cash and warn when cash goes below zero.
--
-- cash_forecast_by_kind() is cash_forecast() with the balance kept twice:
--   cash  liquid accounts of kind 'cash', and the forecast rows whose
--         transaction sits on one
--   bank  everything else -- other liquid accounts, and every row with no
--         account (loan drawdowns and interest, VAT, withholding, expected
--         income, deals, rows not yet given an account): those move through
--         a bank (owner's call).
-- bank_closing + cash_closing = cash_forecast().closing_balance (and the
-- openings likewise), month by month, for the same scenario and scope.
-- New function only: nothing that runs today changes.

create function public.cash_forecast_by_kind(
  p_org uuid,
  p_months int default 12,
  p_scenario text default 'base',
  p_scope owner_scope default null
) returns table (
  month date,
  bank_opening numeric,
  bank_closing numeric,
  cash_opening numeric,
  cash_closing numeric
)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_n int := least(greatest(coalesce(p_months, 12), 1), 36);
  v_m0 date := date_trunc('month', athens_today()::timestamp)::date;
  v_bank numeric;
  v_cash numeric;
begin
  if coalesce(p_scenario, '') not in ('base', 'optimistic', 'pessimistic') then
    raise exception 'Άγνωστο σενάριο πρόβλεψης: %', p_scenario;
  end if;
  if not has_role(p_org, 'viewer') then
    return;
  end if;

  -- Opening per kind, same balance rule as v_liquidity (0066).
  select coalesce(sum(b.balance) filter (where not b.is_cash), 0),
         coalesce(sum(b.balance) filter (where b.is_cash), 0)
    into v_bank, v_cash
  from (
    select a.kind = 'cash' as is_cash, a.opening_balance + coalesce(m.moved, 0) as balance
    from accounts a
    left join lateral (
      select sum(t.signed_amount) as moved
      from transactions t
      where t.account_id = a.id and t.org_id = a.org_id and t.status = 'paid'
        and t.tx_date >= a.opening_balance_date
        and coalesce(t.paid_on, t.tx_date) <= athens_today()
    ) m on true
    where a.org_id = p_org and a.is_liquid and (p_scope is null or a.owner_scope = p_scope)
  ) b;

  return query
  with months as (
    select (v_m0 + make_interval(months => g))::date as m
    from generate_series(0, v_n - 1) g
  ), items as (
    select i.month, coalesce(a.kind = 'cash', false) as is_cash,
           case when i.direction = 'income' then 1 else -1 end
             * i.amount * forecast_weight(i.direction, i.probability, p_scenario) as signed
    from v_cash_forecast_items i
    left join transactions t on i.item_key like 'tx:%' and t.id = i.ref_id
    left join accounts a on a.id = t.account_id
    where i.org_id = p_org and (p_scope is null or i.owner_scope = p_scope)
  ), flows as (
    select mo.m,
           coalesce(sum(it.signed) filter (where not it.is_cash), 0) as fbank,
           coalesce(sum(it.signed) filter (where it.is_cash), 0) as fcash
    from months mo
    left join items it on it.month = mo.m
    group by mo.m
  )
  select f.m,
         round(v_bank + coalesce(sum(f.fbank) over w_before, 0), 2),
         round(v_bank + sum(f.fbank) over w_to, 2),
         round(v_cash + coalesce(sum(f.fcash) over w_before, 0), 2),
         round(v_cash + sum(f.fcash) over w_to, 2)
  from flows f
  window w_to as (order by f.m),
         w_before as (order by f.m rows between unbounded preceding and 1 preceding)
  order by f.m;
end;
$$;
revoke execute on function public.cash_forecast_by_kind(uuid, int, text, owner_scope) from public, anon;
grant execute on function public.cash_forecast_by_kind(uuid, int, text, owner_scope) to authenticated;
