-- 0090: report fixes -- what the reports got wrong, and two new checks.
--
--   v_withholding_position  only rows that really happened: paid, or pending
--                           with an invoice. A scheduled row is a plan, not
--                           tax withheld. Now security invoker (0011 was not).
--   v_account_balances      the Athens date (athens_today()), like
--                           v_liquidity and the net worth, instead of the
--                           server's UTC current_date.
--   v_vat_position          two columns appended: net_issued (from rows with
--                           an invoice: paid or pending) and net_scheduled
--                           (from scheduled rows), so the VAT page can show
--                           «εκδοθέν» and «προβλεπόμενο» apart. They add up
--                           to net_position.
--   vat_paid_in_ledger()    a VAT payment already entered as a transaction
--                           (category treatment 'vat', expense) in the
--                           period's deadline month. That row is already in
--                           the forecast (open) or in the balance (paid), so
--                           the period's payable is not counted a second time
--                           -- neither in the forecast nor in net worth.
--   v_cash_forecast_items   + withholding owed to the tax office, paid at
--                           its deadline (end of the following month), with
--                           the same rules as VAT; VAT skips periods paid in
--                           the ledger.
--   v_qc_expected_vs_scheduled  the same money as an expected income and as
--                           an open ledger row: the forecast counts it twice.
--   v_qc_loan_without_interest  a loan payment with no interest part: the
--                           P&L shows no financing cost for it.
--   v_worklist              the two new checks added.
-- Every view keeps its columns and order (create or replace); cash_forecast()
-- and cash_forecast_items() read the views by name and are unchanged.
-- Nothing is dropped or deleted.

-- ── v_withholding_position ───────────────────────────────────────────────────
create or replace view v_withholding_position with (security_invoker = true) as
select org_id, date_trunc('month', tx_date)::date as period_start,
       sum(withholding_amount) as withheld_total
from transactions
where scope = 'business' and direction = 'expense'
  and (status = 'paid' or (status = 'pending' and has_invoice))
group by 1, 2;

comment on view v_withholding_position is
  'Tax withheld from supplier payments per month: paid rows, and pending rows with an invoice. '
  'Scheduled rows are not withheld yet. Owed to the tax office by withholding_filing_deadline().';

-- ── v_account_balances: same columns as 0050, on the Athens date ─────────────
create or replace view v_account_balances with (security_invoker = true) as
select
  a.id as account_id, a.org_id, a.name, a.kind, a.owner_scope, a.is_liquid,
  a.opening_balance, a.opening_balance_date,
  a.opening_balance + coalesce(sum(t.signed_amount) filter (
    where t.status = 'paid'
      and t.tx_date >= a.opening_balance_date
      and coalesce(t.paid_on, t.tx_date) <= athens_today()
  ), 0) as current_balance,
  a.opening_balance + coalesce(sum(t.signed_amount) filter (
    where t.status in ('paid', 'pending', 'scheduled')
      and t.tx_date >= a.opening_balance_date
  ), 0) as projected_balance
from accounts a
left join transactions t on t.account_id = a.id and t.org_id = a.org_id
group by a.id, a.org_id, a.name, a.kind, a.owner_scope, a.is_liquid,
         a.opening_balance, a.opening_balance_date;

-- ── v_vat_position: 0064 unchanged, net_issued / net_scheduled appended ──────
-- A locked period shows its snapshot, all of it issued (it was filed). An
-- open period: issued = invoiced rows + what rolled in from a locked period,
-- scheduled = scheduled rows. issued + scheduled = net_position.
create or replace view v_vat_position with (security_invoker = true) as
with tx as (
  select t.org_id,
         (case when o.settings->>'vat_period' = 'quarterly'
               then date_trunc('quarter', t.tx_date::timestamp)
               else date_trunc('month', t.tx_date::timestamp) end)::date as period_start,
         case when o.settings->>'vat_period' = 'quarterly' then 3 else 1 end as period_months,
         t.direction, t.vat_amount, t.status = 'scheduled' as is_scheduled
  from transactions t
  join orgs o on o.id = t.org_id
  where t.scope = 'business' and t.status <> 'cancelled'
), live as (
  select org_id, period_start, max(period_months) as period_months,
         coalesce(sum(vat_amount) filter (where direction = 'income'), 0)  as vat_income,
         coalesce(sum(vat_amount) filter (where direction = 'expense'), 0) as vat_expense,
         coalesce(sum(case when direction = 'income' then vat_amount else -vat_amount end)
                  filter (where is_scheduled), 0) as net_scheduled_live
  from tx
  group by org_id, period_start
), base as (
  select l.org_id, l.period_start, l.period_months,
         coalesce(vp.locked, false) as is_locked,
         case when coalesce(vp.locked, false) then coalesce(vp.locked_vat_income, l.vat_income) else l.vat_income end as vat_income,
         case when coalesce(vp.locked, false) then coalesce(vp.locked_vat_expense, l.vat_expense) else l.vat_expense end as vat_expense,
         case when coalesce(vp.locked, false)
              then (l.vat_income - l.vat_expense)
                   - (coalesce(vp.locked_vat_income, l.vat_income) - coalesce(vp.locked_vat_expense, l.vat_expense))
              else 0 end as late_delta,
         case when coalesce(vp.locked, false) then 0 else l.net_scheduled_live end as net_scheduled
  from live l
  left join vat_periods vp on vp.org_id = l.org_id and vp.period_start = l.period_start
), carried as (
  select b.*,
         coalesce((
           select sum(x.late_delta) from base x
           where x.org_id = b.org_id and x.is_locked and x.late_delta <> 0
             and x.period_start < b.period_start
             and not exists (
               select 1 from base y
               where y.org_id = b.org_id and not y.is_locked
                 and y.period_start > x.period_start and y.period_start < b.period_start)
         ), 0) as carried_in
  from base b
), net as (
  select c.*,
         c.vat_income - c.vat_expense + case when c.is_locked then 0 else c.carried_in end as net_position
  from carried c
), running as (
  select n.*,
         sum(n.net_position) over w as s,
         greatest(0, max(sum_to_here) over w) as m
  from (select n.*, sum(n.net_position) over (partition by n.org_id order by n.period_start
                                              rows between unbounded preceding and current row) as sum_to_here
        from net n) n
  window w as (partition by n.org_id order by n.period_start rows between unbounded preceding and current row)
)
select org_id, period_start, vat_income, vat_expense, net_position,
       s - m as credit_balance,
       m - coalesce(lag(m) over (partition by org_id order by period_start), 0) as payable_after_credit,
       vat_filing_deadline(period_start, period_months) as filing_deadline,
       is_locked,
       period_months,
       net_position - net_scheduled as net_issued,
       net_scheduled
from running;

comment on view v_vat_position is
  'One row per VAT period with activity (monthly, or quarterly when '
  'orgs.settings.vat_period = quarterly). credit_balance <= 0 is the credit '
  'carried forward; payable_after_credit is what this period adds to the '
  'amount owed. Filed (locked) periods show their snapshot; later changes '
  'inside them roll into the next open period. net_issued (invoiced rows) + '
  'net_scheduled (scheduled rows) = net_position.';

-- ── vat_paid_in_ledger ───────────────────────────────────────────────────────
-- True when the VAT of the period due at p_filing_deadline is already a
-- ledger row: an expense on a 'vat' category, not cancelled, falling due in
-- the deadline's month. Security invoker: the caller's RLS applies.
create function public.vat_paid_in_ledger(p_org uuid, p_filing_deadline date) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (
    select 1
    from transactions t
    join categories c on c.id = t.category_id
    where t.org_id = p_org
      and c.cost_treatment = 'vat'
      and t.direction = 'expense'
      and t.status <> 'cancelled'
      and date_trunc('month', coalesce(t.due_date, t.tx_date)::timestamp)
          = date_trunc('month', p_filing_deadline::timestamp)
  )
$$;
revoke execute on function public.vat_paid_in_ledger(uuid, date) from public, anon;
grant execute on function public.vat_paid_in_ledger(uuid, date) to authenticated;

-- ── v_cash_forecast_items: 0066 + withholding, VAT without double count ──────
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
-- loan money still to be drawn (approved or disbursed loans only)
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

-- ── v_net_worth_items: 0068, VAT without the ledger-paid periods ─────────────
create or replace view v_net_worth_items with (security_invoker = true) as
select l.org_id, 'cash'::text as component, l.owner_scope, null::uuid as ref_id,
       null::text as label, l.balance as amount
from v_liquidity l

union all
select b.org_id, 'other_accounts', b.owner_scope, b.account_id, b.name, b.current_balance
from v_account_balances b
where not b.is_liquid

union all
select a.org_id, 'assets', a.owner_scope, a.id, a.name, round(a.estimated_value * a.ownership_pct, 2)
from assets a
where a.state = 'held'

union all
select t.org_id, case when t.direction = 'income' then 'receivables' else 'payables' end,
       coalesce(ac.owner_scope, case when t.scope = 'personal' then 'personal' else 'corporate' end::owner_scope),
       t.id, coalesce(nullif(btrim(t.description), ''), t.counterparty_name),
       case when t.direction = 'income' then t.gross_amount else -t.gross_amount end
from transactions t
left join accounts ac on ac.id = t.account_id
where t.status = 'pending'
  and t.loan_id is null

union all
select li.org_id, 'liabilities', li.owner_scope, li.id, li.lender, -li.principal
from liabilities li
where li.state = 'disbursed'

union all
select ln.org_id, 'loans', 'corporate'::owner_scope, ln.id, ln.label,
       -greatest(0, coalesce(d.drawn, 0) - coalesce(r.repaid, 0))
from loans ln
left join lateral (
  select sum(coalesce(dd.actual_amount, dd.amount)) as drawn
  from loan_drawdowns dd
  where dd.loan_id = ln.id
    and (dd.actual_date is not null
         or (ln.state = 'disbursed' and dd.scheduled_month <= athens_today()))
) d on true
left join lateral (
  select sum(t.gross_amount - coalesce(t.interest_amount, 0)) as repaid
  from transactions t
  where t.loan_id = ln.id and t.status = 'paid' and t.direction = 'expense'
) r on true
where ln.state in ('approved', 'disbursed')

union all
select v.org_id, 'vat', 'corporate'::owner_scope, null::uuid, null::text,
       coalesce((select -x.credit_balance from v_vat_position x
                 where x.org_id = v.org_id and x.period_start <= athens_today()
                 order by x.period_start desc limit 1), 0)
       - coalesce((select sum(x.payable_after_credit) from v_vat_position x
                   left join vat_periods vp on vp.org_id = x.org_id and vp.period_start = x.period_start
                   where x.org_id = v.org_id and x.period_start <= athens_today()
                     and x.filing_deadline >= date_trunc('month', athens_today()::timestamp)::date
                     and not coalesce(vp.status = 'paid' or vp.paid_on is not null, false)
                     and not vat_paid_in_ledger(x.org_id, x.filing_deadline)), 0)
from (select distinct org_id from v_vat_position) v;

-- ── v_qc_expected_vs_scheduled ───────────────────────────────────────────────
-- An expected income (or scenario cost) and an open ledger row for the same
-- money: same direction, same month, amount within 1% (at least 1 €), and
-- no conflicting project or contact. The forecast counts both.
create view v_qc_expected_vs_scheduled with (security_invoker = true) as
select e.org_id, e.id as expected_id, t.id as transaction_id, e.direction,
       e.source, e.expected_month, e.amount as expected_amount,
       t.status, coalesce(t.due_date, t.tx_date) as tx_due_date, t.gross_amount as tx_amount,
       coalesce(nullif(btrim(t.description), ''), t.counterparty_name) as tx_label,
       coalesce(e.project_id, t.project_id) as project_id
from expected_income e
join transactions t
  on t.org_id = e.org_id
 and t.direction = e.direction
 and t.status in ('pending', 'scheduled')
 and date_trunc('month', coalesce(t.due_date, t.tx_date)::timestamp) = date_trunc('month', e.expected_month::timestamp)
 and abs(t.gross_amount - e.amount) <= greatest(1, 0.01 * abs(e.amount))
 and (e.project_id is null or t.project_id is null or t.project_id = e.project_id)
 and (e.contact_id is null or t.contact_id is null or t.contact_id = e.contact_id)
where e.status = 'expected' and e.expected_month is not null;

comment on view v_qc_expected_vs_scheduled is
  'The same money both as expected income and as an open ledger row: the cash forecast counts it twice.';

-- ── v_qc_loan_without_interest ───────────────────────────────────────────────
-- A paid or pending payment on an interest-bearing loan with no interest
-- part: the P&L reads only interest_amount from a loan payment, so the cost
-- of the loan is missing.
create view v_qc_loan_without_interest with (security_invoker = true) as
select t.org_id, t.id as transaction_id, t.loan_id, l.label as loan_label,
       coalesce(t.due_date, t.tx_date) as due_date, t.status, t.gross_amount, t.project_id
from transactions t
join loans l on l.id = t.loan_id
where t.direction = 'expense'
  and t.status in ('paid', 'pending')
  and t.interest_amount is null
  and l.interest_rate > 0;

comment on view v_qc_loan_without_interest is
  'Loan payments (paid or pending) with no interest part on an interest-bearing loan: no financing cost in the P&L.';

-- ── v_worklist: 0087 + the two new checks ────────────────────────────────────
create or replace view v_worklist with (security_invoker = true) as
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
  -- the same money counted twice in the forecast
  select org_id, 1, 'expected_vs_scheduled', count(*)::int, null, '/reports/quality'
  from v_qc_expected_vs_scheduled group by org_id
  union all
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
  select org_id, 2, 'uninvoiced_large_expenses', count(*)::int,
         -sum(coalesce(lost_deduction_est, 0) + coalesce(lost_input_vat_est, 0)), '/reports/quality'
  from v_qc_uninvoiced_large_expenses group by org_id
  union all
  -- the P&L misses the financing cost of these payments
  select org_id, 2, 'loan_without_interest', count(*)::int, null, '/reports/quality'
  from v_qc_loan_without_interest group by org_id
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
where i.count > 0 and has_role(i.org_id, 'viewer');
