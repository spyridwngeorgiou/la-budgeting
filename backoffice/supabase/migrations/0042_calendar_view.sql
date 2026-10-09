-- 0042: one calendar for every dated thing
--
-- v_calendar_items merges the planner (tasks, milestones, phases, project
-- key dates) with the money calendar (pending payments, installments, VAT
-- and withholding filings, lease and loan dates) so /planner's calendar is
-- one query with one date filter.
--
-- Two rules keep it safe to show a partner:
--   1. security_invoker, so every branch is filtered by the caller's own
--      RLS on its base table.
--   2. Base tables ONLY. The 0011+ views are org-scoped aggregates written
--      before partners existed; selecting from one here would make this
--      view's exposure depend on theirs. pgTAP (0040_planner.test.sql)
--      fails if this view ever depends on another view.
-- Financial branches read tables partners have no policy on (transactions,
-- vat_periods, project_leases, loans...), so a partner simply gets zero
-- rows from them; is_financial lets the UI hide the toggle as well.

-- The filing deadline used to be inlined in v_vat_position. Monthly regime:
-- last day of the following month. One function so the calendar and the VAT
-- page can never disagree; a quarterly regime (orgs.settings->>'vat_period')
-- changes it here. The ::timestamp picks date_trunc's time-zone-free
-- overload (a bare date resolves to timestamptz), so immutable is honest.
create function public.vat_filing_deadline(p_period_start date) returns date
language sql immutable parallel safe as $$
  select (date_trunc('month', p_period_start::timestamp) + interval '2 month - 1 day')::date
$$;

-- ΦΜΥ / παρακρατούμενοι φόροι: also due by the end of the following month.
create function public.withholding_filing_deadline(p_period_start date) returns date
language sql immutable parallel safe as $$
  select (date_trunc('month', p_period_start::timestamp) + interval '2 month - 1 day')::date
$$;

-- Same columns, same order, same formula -- now through the function. The
-- WITH clause is repeated because create-or-replace resets view options.
create or replace view v_vat_position with (security_invoker = true) as
with base as (
  select org_id, date_trunc('month', tx_date)::date as period_start,
         sum(vat_amount) filter (where direction='income')  as vat_income,
         sum(vat_amount) filter (where direction='expense') as vat_expense
  from transactions
  where scope = 'business' and status <> 'cancelled'
  group by 1,2
), calc as (
  select *, vat_income - vat_expense as net_position,
         sum(vat_income - vat_expense) over (
           partition by org_id order by period_start
           rows between unbounded preceding and current row) as running
  from base
)
select org_id, period_start, vat_income, vat_expense, net_position,
       least(0, running) as credit_balance,
       greatest(0, running - greatest(0, lag(running,1,0) over (partition by org_id order by period_start)))
         as payable_after_credit,
       vat_filing_deadline(period_start) as filing_deadline
from calc;

-- Columns:
--   item_key     stable React key: source + row id (+ subkind)
--   source       task | milestone | phase | project | payment | installment
--                | vat | withholding | lease | loan
--   subkind      which date of a multi-date row (project key dates, lease
--                start/end, loan drawdown/amortisation); null otherwise
--   ref_id       row to link to (task id, transaction id, project id...)
--   starts_on /  a range for phases and dated tasks, the same day otherwise
--   ends_on
--   title        raw text; the UI adds the Greek label for subkind/source
--   status       the source row's own status, as text
--   is_done      filed / paid / completed / done
--   amount       money branches only
create view v_calendar_items with (security_invoker = true) as
select 'task:' || t.id::text as item_key, 'task'::text as source, null::text as subkind,
       t.org_id, t.project_id, t.id as ref_id,
       coalesce(t.start_date, t.due_date) as starts_on, coalesce(t.due_date, t.start_date) as ends_on,
       t.title, t.status::text as status, t.status = 'done' as is_done,
       false as is_financial, null::numeric as amount, null::text as direction
from tasks t
where t.archived_at is null and (t.due_date is not null or t.start_date is not null)

union all
select 'milestone:' || m.id::text, 'milestone', m.kind::text,
       m.org_id, m.project_id, m.id,
       m.due_date, m.due_date,
       m.title, case when m.done_at is null then 'open' else 'done' end, m.done_at is not null,
       false, null, null
from project_milestones m

union all
select 'phase:' || ph.id::text, 'phase', null,
       ph.org_id, ph.project_id, ph.id,
       coalesce(ph.actual_start, ph.planned_start, ph.actual_end, ph.planned_end),
       coalesce(ph.actual_end, ph.planned_end, ph.actual_start, ph.planned_start),
       ph.name, ph.status::text, ph.status = 'done',
       false, null, null
from project_phases ph
where coalesce(ph.actual_start, ph.planned_start, ph.actual_end, ph.planned_end) is not null

union all
select 'project:' || p.id::text || ':' || d.subkind, 'project', d.subkind,
       p.org_id, p.id, p.id,
       d.on_date, d.on_date,
       p.display_name, p.status::text, d.on_date <= current_date,
       false, null, null
from projects p
cross join lateral (values
  ('start_date', p.start_date),
  ('construction_end_date', p.construction_end_date),
  ('opening_date', p.opening_date),
  ('rent_start_date', p.rent_start_date)
) as d(subkind, on_date)
where d.on_date is not null

-- Open payables/receivables, one-off. Installment-plan rows are their own
-- source so the calendar can group them by plan.
union all
select 'payment:' || tx.id::text, 'payment', null,
       tx.org_id, tx.project_id, tx.id,
       tx.due_date, tx.due_date,
       coalesce(nullif(btrim(tx.description), ''), c.name, ''), tx.status::text, false,
       true, tx.gross_amount, tx.direction::text
from transactions tx
left join contacts c on c.id = tx.contact_id
where tx.status in ('pending', 'scheduled') and tx.due_date is not null and tx.plan_id is null

union all
select 'installment:' || tx.id::text, 'installment', null,
       tx.org_id, tx.project_id, tx.id,
       tx.due_date, tx.due_date,
       ip.label, tx.status::text, false,
       true, tx.gross_amount, tx.direction::text
from transactions tx
join installment_plans ip on ip.id = tx.plan_id
where tx.status in ('pending', 'scheduled') and tx.due_date is not null

-- One filing per month that has business activity -- the same periods
-- v_vat_position produces, derived here from transactions directly.
union all
select 'vat:' || v.org_id::text || ':' || v.period_start::text, 'vat', null,
       v.org_id, null, vp.id,
       vat_filing_deadline(v.period_start), vat_filing_deadline(v.period_start),
       to_char(v.period_start, 'MM/YYYY'), coalesce(vp.status::text, 'pending'),
       coalesce(vp.status in ('filed', 'paid'), false),
       true, null, null
from (
  select distinct org_id, date_trunc('month', tx_date)::date as period_start
  from transactions
  where scope = 'business' and status <> 'cancelled'
) v
left join vat_periods vp on vp.org_id = v.org_id and vp.period_start = v.period_start

union all
select 'withholding:' || w.org_id::text || ':' || w.period_start::text, 'withholding', null,
       w.org_id, null, wp.id,
       withholding_filing_deadline(w.period_start), withholding_filing_deadline(w.period_start),
       to_char(w.period_start, 'MM/YYYY'), coalesce(wp.status::text, 'pending'),
       coalesce(wp.status in ('filed', 'paid'), false),
       true, w.withheld, null
from (
  select org_id, date_trunc('month', tx_date)::date as period_start, sum(withholding_amount) as withheld
  from transactions
  where scope = 'business' and direction = 'expense' and status <> 'cancelled' and withholding_amount > 0
  group by 1, 2
) w
left join withholding_periods wp on wp.org_id = w.org_id and wp.period_start = w.period_start

-- Lease start and end only: the monthly rent itself is an installment plan
-- (above), and a 23-year range would paint every day of the grid.
union all
select 'lease:' || l.id::text || ':' || d.subkind, 'lease', d.subkind,
       l.org_id, l.project_id, l.id,
       d.on_date, d.on_date,
       p.display_name, l.kind::text, d.on_date <= current_date,
       true, null, null
from project_leases l
join projects p on p.id = l.project_id
cross join lateral (values
  ('lease_start', l.lease_start_month),
  ('lease_end', (l.lease_start_month + make_interval(years => l.term_years) - interval '1 day')::date)
) as d(subkind, on_date)

union all
select 'loan:' || dd.id::text, 'loan', 'drawdown',
       dd.org_id, ln.project_id, ln.id,
       coalesce(dd.actual_date, dd.scheduled_month), coalesce(dd.actual_date, dd.scheduled_month),
       ln.label, ln.state::text, dd.actual_date is not null,
       true, coalesce(dd.actual_amount, dd.amount), null
from loan_drawdowns dd
join loans ln on ln.id = dd.loan_id

union all
select 'loan:' || ln.id::text || ':amortisation_start', 'loan', 'amortisation_start',
       ln.org_id, ln.project_id, ln.id,
       ln.first_amortisation_month, ln.first_amortisation_month,
       ln.label, ln.state::text, ln.first_amortisation_month <= current_date,
       true, null, null
from loans ln
where ln.first_amortisation_month is not null;
