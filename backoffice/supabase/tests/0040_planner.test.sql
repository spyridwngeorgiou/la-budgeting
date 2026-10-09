-- Planner (0040-0042): RLS matrix, planner_guard, notes CHECK, calendar view.
-- Run: supabase test db   (CI: .github/workflows/ci.yml, job "db")
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(30);

-- A owns org A, B owns org B (handle_new_user), V is a viewer in org A.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'pa@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'pb@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'pv@test.local');

create temp table t_ids (key text primary key, id uuid not null);
grant select on t_ids to authenticated;

insert into t_ids
select 'org_a', org_id from org_members where user_id = '00000000-0000-0000-0000-0000000000a1'
union all
select 'org_b', org_id from org_members where user_id = '00000000-0000-0000-0000-0000000000b1';

insert into org_members (org_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000000c1', 'viewer' from t_ids where key = 'org_a';

with p as (
  insert into projects (org_id, code, display_name, start_date)
  select id, 'PA', 'Έργο A', '2026-10-01' from t_ids where key = 'org_a'
  returning id
) insert into t_ids select 'pa', id from p;
with p as (
  insert into projects (org_id, code, display_name)
  select id, 'PA2', 'Έργο A2' from t_ids where key = 'org_a'
  returning id
) insert into t_ids select 'pa2', id from p;
with p as (
  insert into projects (org_id, code, display_name)
  select id, 'PB', 'Έργο B' from t_ids where key = 'org_b'
  returning id
) insert into t_ids select 'pb', id from p;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.id(k text) returns uuid language sql stable as $$
  select id from t_ids where key = k
$$;

-- ── Owner A: full access; org_id is derived, never trusted ────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

select lives_ok($$
  insert into tasks (org_id, project_id, title, due_date)
  values (pg_temp.id('org_b'), pg_temp.id('pa'), 'Υποβολή αδείας', '2026-10-20')
$$, 'owner creates a task');
select is((select org_id from tasks where title = 'Υποβολή αδείας'), pg_temp.id('org_a'),
  'planner_guard overrides a spoofed org_id with the project''s org');
select lives_ok($$
  insert into task_checklist_items (org_id, project_id, task_id, body)
  select org_id, project_id, id, 'Σχέδια' from tasks where title = 'Υποβολή αδείας'
$$, 'owner adds a checklist item');
select lives_ok($$
  insert into task_comments (org_id, project_id, task_id, body)
  select org_id, project_id, id, 'Ξεκινάμε' from tasks where title = 'Υποβολή αδείας'
$$, 'owner comments as themselves');
select throws_ok($$
  insert into task_comments (org_id, project_id, task_id, author_id, body)
  select org_id, project_id, id, '00000000-0000-0000-0000-0000000000c1', 'Πλαστό'
  from tasks where title = 'Υποβολή αδείας'
$$, '42501', null, 'cannot comment as someone else');
select lives_ok($$
  insert into project_phases (org_id, project_id, name, planned_start, planned_end)
  values (pg_temp.id('org_a'), pg_temp.id('pa2'), 'Μελέτες', '2026-10-01', '2026-12-31')
$$, 'owner creates a phase');
select throws_ok($$
  insert into tasks (org_id, project_id, phase_id, title)
  select pg_temp.id('org_a'), pg_temp.id('pa'), id, 'Λάθος φάση' from project_phases where name = 'Μελέτες'
$$, '23503', null, 'a task cannot use another project''s phase');
select is((select count(*) from planner_projects())::int, 2, 'planner_projects lists own org projects');
select is((select count(*) from planner_people(pg_temp.id('pa')))::int, 2,
  'planner_people lists the project org''s members');

-- ── Viewer V: reads everything, writes nothing ─────────────────────────────
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');

select is((select count(*) from tasks)::int, 1, 'viewer reads tasks');
select is((select count(*) from task_checklist_items)::int, 1, 'viewer reads checklist items');
select is((select count(*) from project_phases)::int, 1, 'viewer reads phases');
select throws_ok($$
  insert into tasks (org_id, project_id, title) values (pg_temp.id('org_a'), pg_temp.id('pa'), 'Viewer')
$$, '42501', null, 'viewer cannot create tasks');
select throws_ok($$
  insert into project_milestones (org_id, project_id, title, due_date)
  values (pg_temp.id('org_a'), pg_temp.id('pa'), 'Viewer', '2026-11-01')
$$, '42501', null, 'viewer cannot create milestones');
select is_empty($$ update tasks set title = 'hacked' returning id $$, 'viewer updates no tasks');
select is_empty($$ delete from tasks returning id $$, 'viewer deletes no tasks');
select is_empty($$ update task_checklist_items set done = true returning id $$, 'viewer cannot tick checklist items');

-- ── Other org B: sees and reaches nothing of A's ───────────────────────────
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');

select is((select count(*) from tasks)::int, 0, 'other org sees no tasks');
select is((select count(*) from task_comments)::int, 0, 'other org sees no comments');
select is((select count(*) from planner_projects() where org_id = pg_temp.id('org_a'))::int, 0,
  'planner_projects hides other org projects');
select is_empty($$ select * from planner_people(pg_temp.id('pa')) $$, 'planner_people hides other org members');
select throws_ok($$
  insert into tasks (org_id, project_id, title) values (pg_temp.id('org_b'), pg_temp.id('pa'), 'Εισβολή')
$$, '42501', null, 'other org cannot create tasks in A''s project');
select is((select count(*) from v_calendar_items where org_id = pg_temp.id('org_a'))::int, 0,
  'other org sees none of A''s calendar items');

-- ── planner_guard: re-homing ───────────────────────────────────────────────
-- Exercised as the table owner (RLS bypassed) with V's JWT, so the trigger
-- itself is what refuses -- RLS would otherwise hide the row first.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);
select throws_ok($$
  update tasks set project_id = pg_temp.id('pa2') where title = 'Υποβολή αδείας'
$$, '42501', null, 'planner_guard blocks a project change by a non-editor');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$
  update tasks set project_id = pg_temp.id('pb') where title = 'Υποβολή αδείας'
$$, '42501', null, 'planner_guard blocks moving a task to another org');
select lives_ok($$
  update tasks set project_id = pg_temp.id('pa2') where title = 'Υποβολή αδείας'
$$, 'editor moves a task between own projects');
select is((select project_id from task_checklist_items where body = 'Σχέδια'), pg_temp.id('pa2'),
  'checklist items follow their task');

select ok(exists(select 1 from v_calendar_items where source = 'task' and title = 'Υποβολή αδείας' and not is_financial),
  'owner sees the task on the calendar as non-financial');
reset role;

-- ── 0041: notes are status/risk only ───────────────────────────────────────
select throws_ok($$
  insert into project_notes (org_id, project_id, kind, body)
  values (pg_temp.id('org_a'), pg_temp.id('pa'), 'action', 'Παλιό είδος')
$$, '23514', null, 'project_notes rejects kind action after 0041');

-- ── 0042: calendar reads base tables only ──────────────────────────────────
select is_empty($$
  select dep.relname
  from pg_rewrite r
  join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
                  and d.refclassid = 'pg_class'::regclass
  join pg_class dep on dep.oid = d.refobjid
  where r.ev_class = 'public.v_calendar_items'::regclass
    and dep.oid <> r.ev_class and dep.relkind in ('v', 'm')
$$, 'v_calendar_items depends on no other view');

select * from finish();
rollback;
