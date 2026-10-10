-- 0066: the cash forecast -- one SQL layer read by /reports/cash, the
-- dashboard and the assistant.
--
-- v_cashflow_monthly (0011) only summed rows already in the ledger, bucketed
-- by invoice date, and left out every scheduled row -- so instalments, loan
-- payments and rent, the biggest known future outflows, never reached it.
-- This replaces it with:
--   v_liquidity            cash in hand per owner scope (liquid accounts only)
--   v_cash_forecast_items  every future cash event, one row each, bucketed
--                          into the month it is expected to move
--   cash_forecast()        the month-by-month runway over those two
--   cash_forecast_items()  the same items with the scenario weight applied,
--                          for the one-month breakdown
-- Every source reads base tables (or v_vat_position, itself security
-- invoker), so a partner -- who has no policy on any of them -- sees nothing.

-- ── v_liquidity ──────────────────────────────────────────────────────────────
-- Same balance rule as v_account_balances.current_balance (0050), but on the
-- Athens date and for liquid accounts only (gold and crypto are wealth, not
-- cash -- they appear in v_net_worth instead). The dashboard, /reports/cash,
-- the AI summary and the forecast all start from this one number.
create view v_liquidity with (security_invoker = true) as
select a.org_id, a.owner_scope,
       sum(a.opening_balance + coalesce(m.moved, 0)) as balance,
       count(*)::int as account_count
from accounts a
left join lateral (
  select sum(t.signed_amount) as moved
  from transactions t
  where t.account_id = a.id and t.org_id = a.org_id and t.status = 'paid'
    and t.tx_date >= a.opening_balance_date
    and coalesce(t.paid_on, t.tx_date) <= athens_today()
) m on true
where a.is_liquid
group by a.org_id, a.owner_scope;

-- ── v_cash_forecast_items ────────────────────────────────────────────────────
-- Columns:
--   source       open | installment | loan | lease | future_paid | drawdown
--                | liability | expected | deal | vat
--   ref_id       the row to link to (transaction, loan, liability, deal...)
--   due_date     when it falls due as recorded
--   month        the month it is forecast to move: an overdue item moves
--                into the current month rather than vanishing into the past
--   probability  1 for anything contractual; < 1 for expected income,
--                pipeline deals and receivables with a collection probability
create view v_cash_forecast_items with (security_invoker = true) as
-- open ledger rows: one-off payables/receivables, instalments, loan and lease schedules
select 'tx:' || t.id::text as item_key, t.org_id,
       case when t.plan_id is not null then 'installment'
            when t.loan_id is not null then 'loan'
            when t.lease_id is not null then 'lease'
            else 'open' end as source,
       t.id as ref_id,
       coalesce(a.owner_scope, case when t.scope = 'personal' then 'personal' else 'corporate' end::owner_scope) as owner_scope,
       t.project_id, coalesce(p.business_line, 'general'::business_line) as business_line,
       t.direction,
       coalesce(nullif(btrim(t.description), ''), c.name, t.counterparty_name, '') as label,
       coalesce(t.due_date, t.tx_date) as due_date,
       greatest(date_trunc('month', coalesce(t.due_date, t.tx_date)::timestamp),
                date_trunc('month', athens_today()::timestamp))::date as month,
       coalesce(t.due_date, t.tx_date) < athens_today() as is_overdue,
       t.gross_amount as amount,
       case when t.direction = 'income' then coalesce(t.collection_probability, 1) else 1 end::numeric as probability
from transactions t
left join accounts a on a.id = t.account_id
left join projects p on p.id = t.project_id
left join contacts c on c.id = t.contact_id
where t.status in ('pending', 'scheduled')
  and (a.id is null or a.is_liquid)

union all
-- paid, but dated to clear after today: not in the balance yet
select 'tx:' || t.id::text, t.org_id, 'future_paid', t.id,
       coalesce(a.owner_scope, case when t.scope = 'personal' then 'personal' else 'corporate' end::owner_scope),
       t.project_id, coalesce(p.business_line, 'general'::business_line),
       t.direction,
       coalesce(nullif(btrim(t.description), ''), c.name, t.counterparty_name, ''),
       coalesce(t.paid_on, t.tx_date),
       date_trunc('month', coalesce(t.paid_on, t.tx_date)::timestamp)::date,
       false,
       t.gross_amount, 1::numeric
from transactions t
left join accounts a on a.id = t.account_id
left join projects p on p.id = t.project_id
left join contacts c on c.id = t.contact_id
where t.status = 'paid'
  and coalesce(t.paid_on, t.tx_date) > athens_today()
  and (a.id is null or (a.is_liquid and t.tx_date >= a.opening_balance_date))

union all
-- loan money still to be drawn (approved or disbursed loans only; an
-- application is not cash yet)
select 'drawdown:' || d.id::text, d.org_id, 'drawdown', l.id,
       'corporate'::owner_scope, l.project_id, coalesce(p.business_line, 'general'::business_line),
       'income'::tx_direction,
       l.label,
       d.scheduled_month,
       greatest(date_trunc('month', d.scheduled_month::timestamp), date_trunc('month', athens_today()::timestamp))::date,
       d.scheduled_month < date_trunc('month', athens_today()::timestamp)::date,
       d.amount, 1::numeric
from loan_drawdowns d
join loans l on l.id = d.loan_id
left join projects p on p.id = l.project_id
where d.actual_date is null and l.state in ('approved', 'disbursed')

union all
-- private loans and other obligations falling due
select 'liability:' || li.id::text, li.org_id, 'liability', li.id,
       li.owner_scope, null::uuid, 'general'::business_line,
       'expense'::tx_direction,
       li.lender,
       li.maturity_date,
       greatest(date_trunc('month', li.maturity_date::timestamp), date_trunc('month', athens_today()::timestamp))::date,
       li.maturity_date < athens_today(),
       li.principal, 1::numeric
from liabilities li
where li.state = 'disbursed' and li.maturity_date is not null

union all
-- expected income (and, from project scenarios, expected costs)
select 'expected:' || e.id::text, e.org_id, 'expected', e.id,
       e.owner_scope, e.project_id, coalesce(e.business_line, p.business_line, 'general'::business_line),
       e.direction,
       e.source,
       e.expected_month,
       greatest(date_trunc('month', e.expected_month::timestamp), date_trunc('month', athens_today()::timestamp))::date,
       e.expected_month < date_trunc('month', athens_today()::timestamp)::date,
       e.amount,
       coalesce(e.probability, case when e.certainty = 'certain' then 1 else 0.5 end)::numeric
from expected_income e
left join projects p on p.id = e.project_id
where e.status = 'expected' and e.expected_month is not null

union all
-- the brokerage pipeline, weighted by stage; a closed deal is a real
-- receivable by now (transaction_id) and is counted through the ledger
select 'deal:' || bd.id::text, bd.org_id, 'deal', bd.id,
       'corporate'::owner_scope, bd.project_id, 'brokerage'::business_line,
       'income'::tx_direction,
       bd.property_label,
       bd.expected_close_date,
       greatest(date_trunc('month', bd.expected_close_date::timestamp), date_trunc('month', athens_today()::timestamp))::date,
       bd.expected_close_date < athens_today(),
       coalesce(bd.commission_amount, round(bd.price * bd.commission_pct, 2)),
       deal_stage_probability(bd.stage)
from brokerage_deals bd
where bd.stage in ('lead', 'offer', 'preliminary') and bd.expected_close_date is not null

union all
-- VAT payable at its filing deadline. Past deadlines are not re-forecast:
-- an unfiled past period is already on the dashboard worklist, and piling
-- every unmarked old period into this month would invent a payment.
select 'vat:' || v.org_id::text || ':' || v.period_start::text, v.org_id, 'vat', vp.id,
       'corporate'::owner_scope, null::uuid, 'general'::business_line,
       'expense'::tx_direction,
       'ΦΠΑ ' || to_char(v.period_start, 'MM/YYYY'),
       v.filing_deadline,
       date_trunc('month', v.filing_deadline::timestamp)::date,
       false,
       v.payable_after_credit, 1::numeric
from v_vat_position v
left join vat_periods vp on vp.org_id = v.org_id and vp.period_start = v.period_start
where v.payable_after_credit > 0
  and v.filing_deadline >= date_trunc('month', athens_today()::timestamp)::date
  and not coalesce(vp.status = 'paid' or vp.paid_on is not null, false);

-- ── Scenario weight ───────────────────────────────────────────────────────────
--   base         income and costs at their probability
--   optimistic   every expected income in full; costs at their probability
--   pessimistic  only certain income; every cost in full
-- Contractual items (probability 1) are identical in all three.
create function public.forecast_weight(p_direction tx_direction, p_probability numeric, p_scenario text)
returns numeric
language sql immutable parallel safe as $$
  select case
    when p_scenario = 'optimistic' and p_direction = 'income' then 1
    when p_scenario = 'pessimistic' and p_direction = 'income' then case when p_probability >= 1 then 1 else 0 end
    when p_scenario = 'pessimistic' then 1
    else coalesce(p_probability, 1)
  end::numeric
$$;

-- ── cash_forecast ─────────────────────────────────────────────────────────────
-- One row per month from the current Athens month, p_months long (1..36):
-- opening_balance (month 1 = v_liquidity today), scenario-weighted inflow
-- and outflow, closing_balance = opening + net, and whether it ends below
-- the org's safety buffer (orgs.settings.min_cash_buffer, default 50.000).
-- p_scope null = corporate + personal.
-- security invoker; zero rows for anyone who is not a member of p_org.
create function public.cash_forecast(
  p_org uuid,
  p_months int default 12,
  p_scenario text default 'base',
  p_scope owner_scope default null
) returns table (
  month date,
  opening_balance numeric,
  inflow numeric,
  outflow numeric,
  net numeric,
  closing_balance numeric,
  uncertain_inflow numeric,
  min_buffer numeric,
  below_buffer boolean
)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_n int := least(greatest(coalesce(p_months, 12), 1), 36);
  v_m0 date := date_trunc('month', athens_today()::timestamp)::date;
  v_buffer numeric;
  v_opening numeric;
begin
  if coalesce(p_scenario, '') not in ('base', 'optimistic', 'pessimistic') then
    raise exception 'Άγνωστο σενάριο πρόβλεψης: %', p_scenario;
  end if;
  if not has_role(p_org, 'viewer') then
    return;
  end if;

  select coalesce(nullif(o.settings->>'min_cash_buffer', '')::numeric, 50000) into v_buffer
  from orgs o where o.id = p_org;

  select coalesce(sum(l.balance), 0) into v_opening
  from v_liquidity l
  where l.org_id = p_org and (p_scope is null or l.owner_scope = p_scope);

  return query
  with months as (
    select (v_m0 + make_interval(months => g))::date as m
    from generate_series(0, v_n - 1) g
  ), flows as (
    select mo.m,
           coalesce(sum(i.amount * forecast_weight(i.direction, i.probability, p_scenario))
                    filter (where i.direction = 'income'), 0) as fin,
           coalesce(sum(i.amount * forecast_weight(i.direction, i.probability, p_scenario))
                    filter (where i.direction = 'expense'), 0) as fout,
           coalesce(sum(i.amount * forecast_weight(i.direction, i.probability, p_scenario))
                    filter (where i.direction = 'income' and i.probability < 1), 0) as funcertain
    from months mo
    left join v_cash_forecast_items i
      on i.month = mo.m and i.org_id = p_org and (p_scope is null or i.owner_scope = p_scope)
    group by mo.m
  ), running as (
    select f.*,
           v_opening + coalesce(sum(f.fin - f.fout) over (order by f.m rows between unbounded preceding and 1 preceding), 0) as opening
    from flows f
  )
  select r.m, round(r.opening, 2), round(r.fin, 2), round(r.fout, 2), round(r.fin - r.fout, 2),
         round(r.opening + r.fin - r.fout, 2), round(r.funcertain, 2), v_buffer,
         r.opening + r.fin - r.fout < v_buffer
  from running r
  order by r.m;
end;
$$;
revoke execute on function public.cash_forecast(uuid, int, text, owner_scope) from public, anon;
grant execute on function public.cash_forecast(uuid, int, text, owner_scope) to authenticated;

-- The items behind one month (or the whole horizon when p_month is null),
-- with the weight cash_forecast applied to each.
create function public.cash_forecast_items(
  p_org uuid,
  p_month date default null,
  p_scenario text default 'base',
  p_scope owner_scope default null
) returns table (
  item_key text,
  source text,
  ref_id uuid,
  owner_scope owner_scope,
  project_id uuid,
  business_line business_line,
  direction tx_direction,
  label text,
  due_date date,
  month date,
  is_overdue boolean,
  amount numeric,
  probability numeric,
  weight numeric,
  weighted_amount numeric
)
language sql stable security invoker set search_path = public as $$
  select i.item_key, i.source, i.ref_id, i.owner_scope, i.project_id, i.business_line, i.direction,
         i.label, i.due_date, i.month, i.is_overdue, i.amount, i.probability,
         forecast_weight(i.direction, i.probability, p_scenario),
         round(i.amount * forecast_weight(i.direction, i.probability, p_scenario), 2)
  from v_cash_forecast_items i
  where i.org_id = p_org
    and coalesce(p_scenario, '') in ('base', 'optimistic', 'pessimistic')
    and (p_month is null or i.month = date_trunc('month', p_month::timestamp)::date)
    and (p_scope is null or i.owner_scope = p_scope)
  order by i.month, i.direction desc, i.amount desc
$$;
revoke execute on function public.cash_forecast_items(uuid, date, text, owner_scope) from public, anon;
grant execute on function public.cash_forecast_items(uuid, date, text, owner_scope) to authenticated;

-- ── Staleness checks (/reports/quality) ───────────────────────────────────────
-- A schedule is stale when its source changed after the rows were last
-- written (an AI-approved edit, a drawdown entered directly), or when an
-- approved loan / indexed lease has never been synced at all.
-- (schedule_synced_at is written by sync_schedule_rows, 0065.)
create view v_qc_schedule_stale with (security_invoker = true) as
select 'loan'::text as kind, l.id as source_id, l.org_id, l.project_id, l.label,
       l.updated_at, l.schedule_synced_at
from loans l
where l.state in ('approved', 'disbursed')
  and exists (select 1 from loan_drawdowns d where d.loan_id = l.id)
  and (l.schedule_synced_at is null or l.updated_at > l.schedule_synced_at)
union all
select 'lease', pl.id, pl.org_id, pl.project_id, p.display_name,
       pl.updated_at, pl.schedule_synced_at
from project_leases pl
join projects p on p.id = pl.project_id
where pl.kind = 'indexed_rent'
  and exists (select 1 from lease_indexed_terms lt where lt.lease_id = pl.id)
  and not exists (select 1 from installment_plans ip
                  where ip.project_id = pl.project_id and ip.obligation_kind = 'rent' and ip.status = 'active')
  and (pl.schedule_synced_at is null or pl.updated_at > pl.schedule_synced_at);

-- Forecast items that are probably no longer true: money that should have
-- moved a while ago and is being carried forward into this month.
create view v_qc_forecast_stale with (security_invoker = true) as
select i.org_id, i.source, i.ref_id, i.label, i.due_date, i.direction, i.amount
from v_cash_forecast_items i
where i.is_overdue
  and (i.source in ('drawdown', 'expected', 'deal', 'liability') or i.due_date < athens_today() - 60);

-- ── Retired ───────────────────────────────────────────────────────────────────
drop view if exists v_cashflow_monthly;
drop function if exists public.v_due_within(uuid, int);
