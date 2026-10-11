-- 0093: phases, task checklists/comments and capital sources are gone (with
-- their enums and the phase_id columns); archive copies exist and stay
-- closed to API roles; v_calendar_items still reads tasks and milestones;
-- tasks and milestones insert without phase_id.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

-- ── Gone ───────────────────────────────────────────────────────────────────
select hasnt_table('public', 'project_phases', 'project_phases dropped');
select hasnt_table('public', 'task_checklist_items', 'task_checklist_items dropped');
select hasnt_table('public', 'task_comments', 'task_comments dropped');
select hasnt_table('public', 'project_capital_sources', 'project_capital_sources dropped');
select hasnt_column('public', 'tasks', 'phase_id', 'tasks.phase_id dropped');
select hasnt_column('public', 'project_milestones', 'phase_id', 'project_milestones.phase_id dropped');
select hasnt_type('public', 'phase_status', 'enum phase_status dropped');
select hasnt_type('public', 'capital_source_kind', 'enum capital_source_kind dropped');
select has_column('public', 'projects', 'phase', 'projects.phase (unrelated) is kept');

-- ── Archived, and closed to API roles ──────────────────────────────────────
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'archive'
          and c.relname in ('project_phases', 'task_checklist_items', 'task_comments', 'project_capital_sources')
        order by 1),
  array['project_capital_sources', 'project_phases', 'task_checklist_items', 'task_comments'],
  'each dropped table has an archive copy');
select ok(not has_table_privilege('authenticated', 'archive.project_phases', 'select'),
  'authenticated cannot read archive.project_phases');

-- ── Calendar and planner still work ────────────────────────────────────────
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000093a1', 'a93@test.local');

create temp table t_ids (key text primary key, id uuid not null);
grant select on t_ids to authenticated;
insert into t_ids select 'org', org_id from org_members where user_id = '00000000-0000-0000-0000-0000000093a1';
with p as (
  insert into projects (org_id, code, display_name)
  select id, 'P93', 'Έργο 93' from t_ids where key = 'org'
  returning id
) insert into t_ids select 'p', id from p;

create function pg_temp.id(k text) returns uuid language sql stable as $$
  select id from t_ids where key = k
$$;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         json_build_object('sub', '00000000-0000-0000-0000-0000000093a1', 'role', 'authenticated')::text, true);

select lives_ok($$
  insert into tasks (org_id, project_id, title, start_date, due_date)
  values (pg_temp.id('org'), pg_temp.id('p'), 'Αυτοψία', '2026-11-02', '2026-11-04')
$$, 'a task inserts without phase_id');
select lives_ok($$
  insert into project_milestones (org_id, project_id, title, kind, due_date)
  values (pg_temp.id('org'), pg_temp.id('p'), 'Άδεια δόμησης', 'permit', '2026-11-30')
$$, 'a milestone inserts without phase_id');
select lives_ok($$
  insert into tasks (org_id, project_id, milestone_id, title)
  select org_id, project_id, id, 'Φάκελος αδείας' from project_milestones where title = 'Άδεια δόμησης'
$$, 'a task can still point at a milestone');

select is(
  array(select source || ':' || title from v_calendar_items
        where project_id = pg_temp.id('p') and source in ('task', 'milestone') order by source, title),
  array['milestone:Άδεια δόμησης', 'task:Αυτοψία'],
  'v_calendar_items lists the dated task and the milestone');
select is(
  (select array[starts_on, ends_on] from v_calendar_items where source = 'task' and title = 'Αυτοψία'),
  array['2026-11-02'::date, '2026-11-04'::date],
  'a task keeps its date range on the calendar');
reset role;

select is(
  (select count(*) from v_calendar_items where source = 'phase')::int, 0,
  'v_calendar_items has no phase source');

select * from finish();
rollback;
