-- set_base_scenario (0089): an editor moves the base; a viewer and another
-- org cannot; a project never ends up with two bases (or none after a
-- refused call).
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000089a0', 'a89@test.local'),
  ('00000000-0000-0000-0000-0000000089b0', 'b89@test.local'),
  ('00000000-0000-0000-0000-0000000089c0', 'viewer89@test.local'),
  ('00000000-0000-0000-0000-0000000089d0', 'editor89@test.local');

create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-0000000089a0', '00000000-0000-0000-0000-0000000089b0');
grant select on t_org to authenticated;

create function pg_temp.org_a() returns uuid language sql as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000089a0'
$$;
create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.base_of(p_project uuid) returns setof uuid language sql as $$
  select id from project_scenarios where project_id = p_project and is_base
$$;

insert into org_members (org_id, user_id, role) values
  (pg_temp.org_a(), '00000000-0000-0000-0000-0000000089c0', 'viewer'),
  (pg_temp.org_a(), '00000000-0000-0000-0000-0000000089d0', 'editor');

insert into projects (id, org_id, code, display_name) values
  ('89000000-0000-0000-0000-0000000000f1', pg_temp.org_a(), 'P89', 'Έργο 89'),
  ('89000000-0000-0000-0000-0000000000f2', pg_temp.org_a(), 'P89B', 'Άλλο έργο');

-- Three scenarios on P89 (the first is the base), one base on the other
-- project of the same org.
insert into project_scenarios (id, org_id, project_id, code, name, is_base) values
  ('89000000-0000-0000-0000-000000000001', pg_temp.org_a(), '89000000-0000-0000-0000-0000000000f1', 'base', 'Βασικό', true),
  ('89000000-0000-0000-0000-000000000002', pg_temp.org_a(), '89000000-0000-0000-0000-0000000000f1', 's2', 'Συντηρητικό', false),
  ('89000000-0000-0000-0000-000000000003', pg_temp.org_a(), '89000000-0000-0000-0000-0000000000f1', 's3', 'Αισιόδοξο', false),
  ('89000000-0000-0000-0000-000000000009', pg_temp.org_a(), '89000000-0000-0000-0000-0000000000f2', 'base', 'Βασικό', true);

-- ---- editor -------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000089d0');
select lives_ok($$ select set_base_scenario('89000000-0000-0000-0000-000000000002') $$, 'an editor sets the base');
select lives_ok($$ select set_base_scenario('89000000-0000-0000-0000-000000000002') $$, 'setting the current base again is a no-op');
reset role;
select results_eq(
  $$ select pg_temp.base_of('89000000-0000-0000-0000-0000000000f1') $$,
  $$ values ('89000000-0000-0000-0000-000000000002'::uuid) $$,
  'the chosen scenario is now the only base'
);
select is(
  (select count(*)::int from project_scenarios where project_id = '89000000-0000-0000-0000-0000000000f1' and is_base), 1,
  'still exactly one base'
);
select is(
  (select is_base from project_scenarios where id = '89000000-0000-0000-0000-000000000009'), true,
  'the other project keeps its own base'
);

-- ---- owner moves it again -------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000089a0');
select lives_ok($$ select set_base_scenario('89000000-0000-0000-0000-000000000003') $$, 'the owner sets the base');
reset role;
select results_eq(
  $$ select pg_temp.base_of('89000000-0000-0000-0000-0000000000f1') $$,
  $$ values ('89000000-0000-0000-0000-000000000003'::uuid) $$,
  'single base after a second move'
);

-- ---- viewer -------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000089c0');
select throws_ok(
  $$ select set_base_scenario('89000000-0000-0000-0000-000000000001') $$, '42501', null,
  'a viewer cannot set the base'
);
reset role;
select results_eq(
  $$ select pg_temp.base_of('89000000-0000-0000-0000-0000000000f1') $$,
  $$ values ('89000000-0000-0000-0000-000000000003'::uuid) $$,
  'the viewer''s call changed nothing'
);

-- ---- another org ----------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000089b0');
select throws_ok(
  $$ select set_base_scenario('89000000-0000-0000-0000-000000000001') $$, 'P0002', null,
  'another org cannot even see the scenario'
);
reset role;
select results_eq(
  $$ select pg_temp.base_of('89000000-0000-0000-0000-0000000000f1') $$,
  $$ values ('89000000-0000-0000-0000-000000000003'::uuid) $$,
  'the other org''s call changed nothing'
);

-- ---- invariant ------------------------------------------------------------------
select throws_ok(
  $$ update project_scenarios set is_base = true where id = '89000000-0000-0000-0000-000000000001' $$, '23505', null,
  'a second base is still refused by project_scenarios_one_base_uq'
);
select is(
  has_function_privilege('anon', 'public.set_base_scenario(uuid)', 'execute'), false,
  'anon cannot call it'
);

select * from finish();
rollback;
