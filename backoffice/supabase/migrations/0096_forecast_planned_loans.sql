-- 0096: the cash forecast counts the drawdowns of a loan still in application.
--
-- The construction a loan pays for is already in the forecast as scheduled
-- payments (e.g. Λαζαράκη 32, phases A–C in 2027); leaving the loan's own
-- drawdowns out until the bank approves made the forecast run ~1,3M below
-- zero. Owner's call (14/10/2026): count both, as the «Με δάνειο & κατασκευή»
-- plan. Only a repaid loan has nothing left to draw. With the money in, its
-- cost comes in too: the grace-period interest on what has been drawn (new
-- source 'loan_interest'; amortisation starts later, from
-- first_amortisation_month).
--
-- v_cash_forecast_items as in 0090, with two changes: the drawdown filter
-- (l.state <> 'repaid' instead of in ('approved', 'disbursed')) and the
-- loan_interest rows after it.
-- Same columns, same order: cash_forecast() / cash_forecast_items() read it
-- by name and are unchanged. Additive, so the running code is unaffected.

create or replace view v_cash_forecast_items with (security_invoker = true) as
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
-- loan money still to be drawn (any loan not yet repaid, see above)
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
where d.actual_date is null and l.state <> 'repaid'

union all
-- interest on the money drawn, monthly, during grace (before the first
-- amortisation month): simple interest on what has been drawn by the start
-- of the month, the same base as lib/finance/loan.ts. Skipped for a loan
-- whose payments are already in the ledger as open rows (source 'loan').
select 'loan_interest:' || l.id::text || ':' || to_char(m.month, 'YYYY-MM'), l.org_id, 'loan_interest', l.id,
       'corporate'::owner_scope, l.project_id, coalesce(p.business_line, 'general'::business_line),
       'expense'::tx_direction,
       l.label || ' — τόκοι',
       m.month::date,
       m.month::date,
       false,
       round(dr.drawn * l.interest_rate / 12, 2), 1::numeric
from loans l
left join projects p on p.id = l.project_id
cross join lateral generate_series(
  date_trunc('month', athens_today()::timestamp),
  date_trunc('month', athens_today()::timestamp) + interval '23 months',
  interval '1 month') as m(month)
cross join lateral (
  select coalesce(sum(coalesce(d.actual_amount, d.amount)), 0) as drawn
  from loan_drawdowns d
  where d.loan_id = l.id and coalesce(d.actual_date, d.scheduled_month) <= m.month::date
) dr
where l.state <> 'repaid'
  and dr.drawn > 0
  and l.interest_rate > 0
  and (l.first_amortisation_month is null or m.month::date < l.first_amortisation_month)
  and not exists (
    select 1 from transactions t
    where t.loan_id = l.id and t.status in ('pending', 'scheduled'))

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
-- the brokerage pipeline, weighted by stage
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
-- VAT payable at its filing deadline (issued and scheduled alike). Past
-- deadlines are not re-forecast (they are on the worklist), and a period
-- whose payment is already a ledger row is counted through that row.
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
  and not coalesce(vp.status = 'paid' or vp.paid_on is not null, false)
  and not vat_paid_in_ledger(v.org_id, v.filing_deadline)

union all
-- tax withheld from suppliers, owed to the tax office by the end of the
-- following month; same rules as VAT (no past deadlines, not once paid)
select 'withholding:' || w.org_id::text || ':' || w.period_start::text, w.org_id, 'withholding', wp.id,
       'corporate'::owner_scope, null::uuid, 'general'::business_line,
       'expense'::tx_direction,
       'Παρακράτηση ' || to_char(w.period_start, 'MM/YYYY'),
       withholding_filing_deadline(w.period_start),
       date_trunc('month', withholding_filing_deadline(w.period_start)::timestamp)::date,
       false,
       w.withheld_total, 1::numeric
from v_withholding_position w
left join withholding_periods wp on wp.org_id = w.org_id and wp.period_start = w.period_start
where w.withheld_total > 0
  and withholding_filing_deadline(w.period_start) >= date_trunc('month', athens_today()::timestamp)::date
  and not coalesce(wp.status = 'paid' or wp.paid_on is not null, false);
