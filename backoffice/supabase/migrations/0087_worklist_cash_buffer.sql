-- 0087: the «Σήμερα» home (redesign Φ1) -- the org's cash buffer as a real
-- column, and one worklist view over every data-quality check.
--
--   orgs.cash_buffer   the safety buffer the cash forecast compares against.
--                      Until now it lived only in orgs.settings
--                      ->> 'min_cash_buffer' (default 50.000); the column is
--                      filled from there, and null still means "fall back to
--                      the setting, then 50.000" (org_cash_buffer()).
--   cash_forecast()    unchanged except that it reads org_cash_buffer().
--   v_worklist         «Να γίνουν»: one row per open check per org, with a
--                      tier (1 money, 2 compliance, 3 housekeeping), a stable
--                      code (the label lives in the app, i18n/v2/home.ts),
--                      the count, an amount where one means something, and
--                      the page where it gets fixed.
-- Nothing is dropped or deleted.

-- ── orgs.cash_buffer ─────────────────────────────────────────────────────────
alter table orgs add column cash_buffer numeric(14,2)
  constraint orgs_cash_buffer_nonneg check (cash_buffer is null or cash_buffer >= 0);

comment on column orgs.cash_buffer is
  'Cash safety buffer for the forecast. Null = orgs.settings.min_cash_buffer, else 50.000 (org_cash_buffer()).';

update orgs
set cash_buffer = round((settings ->> 'min_cash_buffer')::numeric, 2)
where cash_buffer is null
  and settings ->> 'min_cash_buffer' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$';

-- The buffer in force for an org: the column, then the legacy setting, then
-- 50.000. Security invoker: reads orgs under the caller's RLS.
create function public.org_cash_buffer(p_org uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(o.cash_buffer, nullif(o.settings ->> 'min_cash_buffer', '')::numeric, 50000)
  from orgs o
  where o.id = p_org
$$;
revoke execute on function public.org_cash_buffer(uuid) from public, anon;
grant execute on function public.org_cash_buffer(uuid) to authenticated;

-- ── cash_forecast: the same body as 0066, buffer from org_cash_buffer() ──────
create or replace function public.cash_forecast(
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

  v_buffer := coalesce(org_cash_buffer(p_org), 50000);

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

-- ── v_worklist ───────────────────────────────────────────────────────────────
-- amount is signed from the org's side: + money coming in, − money going
-- out or at risk; null where a sum would mean nothing (a count of
-- duplicates). href is a real page today; the redirects of Φ7 carry it on.
create view v_worklist with (security_invoker = true) as
with items as (
  -- ── tier 1: money ──
  select t.org_id, 1 as tier, 'overdue_payables' as code, count(*)::int as count,
         -sum(t.gross_amount) as amount,
         '/transactions?ids=' || array_to_string((array_agg(t.id order by t.due_date))[1:100], ',') as href
  from transactions t
  where t.status in ('pending', 'scheduled') and t.direction = 'expense' and t.due_date < athens_today()
  group by t.org_id
  union all
  select t.org_id, 1, 'overdue_receivables', count(*)::int, sum(t.gross_amount),
         '/transactions?ids=' || array_to_string((array_agg(t.id order by t.due_date))[1:100], ',')
  from transactions t
  where t.status in ('pending', 'scheduled') and t.direction = 'income' and t.due_date < athens_today()
  group by t.org_id
  union all
  -- months of the next twelve ending below the buffer; amount = the deepest shortfall
  select o.id, 1, 'below_buffer', count(*)::int, min(f.closing_balance - f.min_buffer), '/reports/cash'
  from orgs o
  cross join lateral cash_forecast(o.id, 12, 'base', null) f
  where f.below_buffer
  group by o.id
  union all
  select org_id, 1, 'duplicate_fingerprints', count(*)::int, null::numeric, '/reports/quality'
  from v_qc_duplicate_fingerprints group by org_id
  union all
  select org_id, 1, 'account_drift', count(*)::int, null, '/accounts'
  from v_qc_account_drift where issue = 'drift' group by org_id
  union all
  select org_id, 1, 'schedule_stale', count(*)::int, null, '/reports/quality'
  from v_qc_schedule_stale group by org_id
  union all
  select org_id, 1, 'forecast_stale', count(*)::int,
         sum(case when direction = 'income' then amount else -amount end), '/reports/quality'
  from v_qc_forecast_stale group by org_id
  union all
  -- a period whose filing deadline has passed and nobody marked filed or paid
  select v.org_id, 1, 'vat_unfiled', count(*)::int, null, '/reports/vat'
  from v_vat_position v
  left join vat_periods vp on vp.org_id = v.org_id and vp.period_start = v.period_start
  where v.filing_deadline < athens_today()
    and not coalesce(vp.status in ('filed', 'paid'), false)
  group by v.org_id
  -- ── tier 2: compliance ──
  union all
  select org_id, 2, 'vat_mismatch', count(*)::int, null, '/reports/quality'
  from v_qc_vat_mismatch group by org_id
  union all
  select org_id, 2, 'afm_mismatch', count(*)::int, null, '/reports/quality'
  from v_qc_afm_mismatch group by org_id
  union all
  select org_id, 2, 'amount_identity_mismatch', count(*)::int, null, '/reports/quality'
  from v_qc_amount_identity_mismatch group by org_id
  union all
  select org_id, 2, 'withholding_on_income', count(*)::int, null, '/reports/quality'
  from v_qc_withholding_on_income group by org_id
  union all
  select org_id, 2, 'duplicate_invoice_numbers', count(*)::int, null, '/reports/quality'
  from v_qc_duplicate_invoice_numbers group by org_id
  union all
  -- the tax and input VAT lost without an invoice
  select org_id, 2, 'uninvoiced_large_expenses', count(*)::int,
         -sum(coalesce(lost_deduction_est, 0) + coalesce(lost_input_vat_est, 0)), '/reports/quality'
  from v_qc_uninvoiced_large_expenses group by org_id
  -- ── tier 3: housekeeping ──
  union all
  select org_id, 3, 'missing_project_or_account', count(*)::int, null, '/reports/quality'
  from v_qc_missing_project_or_account group by org_id
  union all
  select org_id, 3, 'account_uncounted', count(*)::int, null, '/accounts'
  from v_qc_account_drift where issue <> 'drift' group by org_id
  union all
  select org_id, 3, 'counterparty_without_contact', sum(n)::int, null, '/reports/quality'
  from v_qc_counterparty_without_contact group by org_id
  union all
  select org_id, 3, 'contacts_missing_afm', count(*)::int, null, '/reports/quality'
  from v_qc_contacts_missing_afm group by org_id
  union all
  select org_id, 3, 'duplicate_contact_afm', count(*)::int, null, '/reports/quality'
  from v_qc_duplicate_contact_afm group by org_id
  union all
  select org_id, 3, 'future_dated', count(*)::int, null, '/reports/quality'
  from v_qc_future_dated group by org_id
  union all
  select org_id, 3, 'non_positive_amounts', count(*)::int, null, '/reports/quality'
  from v_qc_non_positive_amounts group by org_id
  union all
  select org_id, 3, 'capex_to_lessor', count(*)::int, null, '/reports/quality'
  from v_qc_capex_to_lessor group by org_id
  union all
  select org_id, 3, 'spend_without_treatment', count(*)::int, null, '/reports/quality'
  from v_qc_spend_without_treatment group by org_id
  union all
  select org_id, 3, 'projects_without_budget', count(*)::int, null, '/reports/quality'
  from v_qc_projects_without_budget group by org_id
)
select i.org_id, i.tier, i.code, i.code as label_key, i.count, round(i.amount, 2) as amount, i.href
from items i
-- Staff of the org only: a project partner who can read one of the
-- underlying tables (projects, say) still gets nothing here.
where i.count > 0 and has_role(i.org_id, 'viewer');

comment on view v_worklist is
  '«Να γίνουν» on the home page: open data-quality checks per org, tier 1 money / 2 compliance / 3 housekeeping.';
