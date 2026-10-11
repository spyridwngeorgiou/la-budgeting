-- 0093: drop the features the owner removed -- planner phases (and the
-- timeline view built on them), task checklists, task comments and project
-- capital sources. All four tables have 0 rows in production.
--
-- Destructive, so it is careful:
--   1. every table must be EMPTY, or the whole migration aborts (RAISE) --
--      nothing is ever dropped with data in it;
--   2. each table is still copied to archive.<table> first (0085's pattern:
--      schema archive, no access for API roles), enum columns as text so
--      the enums can go;
--   3. v_calendar_items is recreated without its phase branch (same
--      columns, still security_invoker) before project_phases goes;
--   4. tasks.phase_id / project_milestones.phase_id lose their FK, then
--      the column;
--   5. before each drop, pg_depend is checked for views or foreign keys of
--      OTHER relations on the table (RAISE if any); the tables are then
--      dropped WITHOUT cascade, so anything missed still stops the drop.
--      Their own policies and triggers are dropped explicitly first;
--   6. the enums phase_status and capital_source_kind are dropped.
-- Unrelated and kept: projects.phase (a plain text column of the project).
-- pgTAP: supabase/tests/0093_drop_unused.test.sql.

-- ── 1. Refuse to drop anything that holds data ─────────────────────────────
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['project_phases', 'task_checklist_items', 'task_comments', 'project_capital_sources'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      raise exception '0093: public.% has % row(s); refusing to drop it', t, n;
    end if;
  end loop;
end;
$$;

-- ── 2. Archive copies ──────────────────────────────────────────────────────
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table if not exists archive.project_phases (like public.project_phases);
alter table archive.project_phases alter column status type text;
alter table archive.project_phases add column if not exists archived_at timestamptz not null default now();
insert into archive.project_phases
  (id, org_id, project_id, name, status, planned_start, planned_end, actual_start, actual_end,
   sort_order, created_by, created_at, updated_at)
select id, org_id, project_id, name, status::text, planned_start, planned_end, actual_start, actual_end,
       sort_order, created_by, created_at, updated_at
from public.project_phases;

create table if not exists archive.task_checklist_items (like public.task_checklist_items);
alter table archive.task_checklist_items add column if not exists archived_at timestamptz not null default now();
insert into archive.task_checklist_items
  (id, org_id, project_id, task_id, body, done, sort_order, created_at, updated_at)
select id, org_id, project_id, task_id, body, done, sort_order, created_at, updated_at
from public.task_checklist_items;

create table if not exists archive.task_comments (like public.task_comments);
alter table archive.task_comments add column if not exists archived_at timestamptz not null default now();
insert into archive.task_comments
  (id, org_id, project_id, task_id, author_id, body, created_at, updated_at)
select id, org_id, project_id, task_id, author_id, body, created_at, updated_at
from public.task_comments;

create table if not exists archive.project_capital_sources (like public.project_capital_sources);
alter table archive.project_capital_sources alter column kind type text;
alter table archive.project_capital_sources add column if not exists archived_at timestamptz not null default now();
insert into archive.project_capital_sources
  (id, org_id, project_id, kind, contributor, amount, contributed_on, notes, created_at)
select id, org_id, project_id, kind::text, contributor, amount, contributed_on, notes, created_at
from public.project_capital_sources;

revoke all on archive.project_phases, archive.task_checklist_items, archive.task_comments,
  archive.project_capital_sources from public, anon, authenticated;

-- ── 3. v_calendar_items without the phase branch ───────────────────────────
-- Same columns, same order, same branches as 0042 minus 'phase'. create or
-- replace keeps the view's grants.
create or replace view v_calendar_items with (security_invoker = true) as
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

-- ── 4. phase_id off tasks and milestones ───────────────────────────────────
-- The FK first (by name, as 0040 created it), then the column; the partial
-- phase_id indexes go with the column.
alter table project_milestones drop constraint if exists project_milestones_phase_id_project_id_fkey;
alter table project_milestones drop column if exists phase_id;
alter table tasks drop constraint if exists tasks_phase_id_project_id_fkey;
alter table tasks drop column if exists phase_id;

-- ── 5. Drop the tables ─────────────────────────────────────────────────────
-- What else still depends on them: a view/rule of another relation, or a
-- foreign key from a table that is not itself being dropped here.
do $$
declare
  dropping regclass[] := array[
    'public.project_phases', 'public.task_checklist_items', 'public.task_comments',
    'public.project_capital_sources'
  ]::regclass[];
  t regclass;
  dep text;
begin
  foreach t in array dropping loop
    select string_agg(x, ', ') into dep from (
      select distinct r.ev_class::regclass::text as x
      from pg_depend d
      join pg_rewrite r on d.classid = 'pg_rewrite'::regclass and r.oid = d.objid
      where d.refclassid = 'pg_class'::regclass and d.refobjid = t::oid and r.ev_class <> t::oid
      union
      select distinct c.conrelid::regclass::text
      from pg_constraint c
      where c.contype = 'f' and c.confrelid = t::oid and c.conrelid <> all (dropping::oid[])
    ) s;
    if dep is not null then
      raise exception '0093: % is still used by %; refusing to drop it', t, dep;
    end if;
  end loop;
end;
$$;

drop policy if exists task_comments_select on task_comments;
drop policy if exists task_comments_insert on task_comments;
drop policy if exists task_comments_update on task_comments;
drop policy if exists task_comments_delete on task_comments;
drop trigger if exists task_comments_set_updated_at on task_comments;
drop trigger if exists task_comments_guard on task_comments;
drop table task_comments;

drop policy if exists task_checklist_items_select on task_checklist_items;
drop policy if exists task_checklist_items_insert on task_checklist_items;
drop policy if exists task_checklist_items_update on task_checklist_items;
drop policy if exists task_checklist_items_delete on task_checklist_items;
drop trigger if exists task_checklist_items_set_updated_at on task_checklist_items;
drop trigger if exists task_checklist_items_guard on task_checklist_items;
drop table task_checklist_items;

drop policy if exists project_phases_select on project_phases;
drop policy if exists project_phases_insert on project_phases;
drop policy if exists project_phases_update on project_phases;
drop policy if exists project_phases_delete on project_phases;
drop trigger if exists project_phases_set_updated_at on project_phases;
drop trigger if exists project_phases_guard on project_phases;
drop table project_phases;

drop policy if exists project_capital_sources_select on project_capital_sources;
drop policy if exists project_capital_sources_insert on project_capital_sources;
drop policy if exists project_capital_sources_update on project_capital_sources;
drop policy if exists project_capital_sources_delete on project_capital_sources;
drop table project_capital_sources;

-- ── 6. Their enums ─────────────────────────────────────────────────────────
drop type phase_status;
drop type capital_source_kind;
