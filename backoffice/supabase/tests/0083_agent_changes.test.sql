-- apply_agent_change (0082/0083): atomic, stale-checked, allowlisted, once.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000083a0', 'a83@test.local'),
  ('00000000-0000-0000-0000-0000000083b0', 'b83@test.local'),
  ('00000000-0000-0000-0000-0000000083c0', 'viewer83@test.local');

create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-0000000083a0', '00000000-0000-0000-0000-0000000083b0');
grant select on t_org to authenticated;

create function pg_temp.org_a() returns uuid language sql as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000083a0'
$$;
create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into org_members (org_id, user_id, role)
values (pg_temp.org_a(), '00000000-0000-0000-0000-0000000083c0', 'viewer');

insert into contacts (id, org_id, name, phone, email, notes)
values ('83000000-0000-0000-0000-00000000c001', pg_temp.org_a(), 'Παλιό Όνομα', '210', 'a@x.gr', null);

-- "Long ago": the row has moved on since every proposal below was made
-- (now() is constant inside a test transaction, so updated_at can't move).
create function pg_temp.long_ago() returns timestamptz language sql as $$ select timestamptz '2000-01-01' $$;

create function pg_temp.propose(p_id uuid, p_before jsonb, p_after jsonb, p_base timestamptz) returns void
language sql as $$
  insert into agent_changes (id, org_id, table_name, row_id, operation, before, after, changed_fields, base_updated_at, requested_by)
  values (p_id, pg_temp.org_a(), 'contacts', '83000000-0000-0000-0000-00000000c001', 'update', p_before, p_after,
          array(select jsonb_object_keys(p_after)), p_base, '00000000-0000-0000-0000-0000000083a0');
$$;

select pg_temp.propose('83000000-0000-0000-0000-000000000001', '{"name": "Παλιό Όνομα"}', '{"name": "Νέο Όνομα"}',
  (select updated_at from contacts where id = '83000000-0000-0000-0000-00000000c001'));

-- ---- happy path + double approve -------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000083a0');
select is(apply_agent_change('83000000-0000-0000-0000-000000000001') ->> 'status', 'approved', 'fresh proposal applies');
select is((select name from contacts where id = '83000000-0000-0000-0000-00000000c001'), 'Νέο Όνομα', 'the field was written');
select throws_ok($$ select apply_agent_change('83000000-0000-0000-0000-000000000001') $$, 'P0001', null,
  'a second approval is refused');
select is((select status::text from agent_changes where id = '83000000-0000-0000-0000-000000000001'), 'approved',
  'status is approved once');
reset role;

-- ---- drift: another field changed since -> applies, and keeps that change --
update contacts set notes = 'σημείωση άλλου' where id = '83000000-0000-0000-0000-00000000c001';
select pg_temp.propose('83000000-0000-0000-0000-000000000002', '{"phone": "210"}', '{"phone": "211"}', pg_temp.long_ago());
select pg_temp.as_user('00000000-0000-0000-0000-0000000083a0');
select is(apply_agent_change('83000000-0000-0000-0000-000000000002') ->> 'status', 'approved', 'drift elsewhere does not block');
select is((select phone from contacts where id = '83000000-0000-0000-0000-00000000c001'), '211', 'drift: changed field written');
select is((select notes from contacts where id = '83000000-0000-0000-0000-00000000c001'), 'σημείωση άλλου',
  'drift: the other change is not clobbered');
reset role;

-- ---- conflict: the same field changed since ---------------------------------
update contacts set email = 'c@x.gr' where id = '83000000-0000-0000-0000-00000000c001';
select pg_temp.propose('83000000-0000-0000-0000-000000000003', '{"email": "a@x.gr"}', '{"email": "b@x.gr"}', pg_temp.long_ago());
select pg_temp.as_user('00000000-0000-0000-0000-0000000083a0');
select is(apply_agent_change('83000000-0000-0000-0000-000000000003') ->> 'status', 'conflict', 'same-field change is a conflict');
select is((select email from contacts where id = '83000000-0000-0000-0000-00000000c001'), 'c@x.gr', 'conflict writes nothing');
select is((select conflict -> 'email' ->> 'current' from agent_changes where id = '83000000-0000-0000-0000-000000000003'),
  'c@x.gr', 'conflict records the current value');
select is(apply_agent_change('83000000-0000-0000-0000-000000000003', true) ->> 'status', 'approved', 'a conflict can be forced');
select is((select email from contacts where id = '83000000-0000-0000-0000-00000000c001'), 'b@x.gr', 'forced value written');
reset role;

-- ---- column not allowlisted ---------------------------------------------------
select pg_temp.propose('83000000-0000-0000-0000-000000000004', '{"org_id": null}',
  jsonb_build_object('org_id', (select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000083b0')),
  (select updated_at from contacts where id = '83000000-0000-0000-0000-00000000c001'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000083a0');
select is(apply_agent_change('83000000-0000-0000-0000-000000000004') ->> 'status', 'failed', 'a non-allowlisted column fails');
select is((select org_id from contacts where id = '83000000-0000-0000-0000-00000000c001'), pg_temp.org_a(),
  'nothing was written');
select is((select status::text from agent_changes where id = '83000000-0000-0000-0000-000000000004'), 'failed',
  'the failure is recorded');
reset role;

-- ---- roles and immutability ---------------------------------------------------
select pg_temp.propose('83000000-0000-0000-0000-000000000005', '{"phone": "211"}', '{"phone": "212"}',
  (select updated_at from contacts where id = '83000000-0000-0000-0000-00000000c001'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000083c0');
select throws_ok($$ select apply_agent_change('83000000-0000-0000-0000-000000000005') $$, null, null,
  'a viewer cannot approve');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000083b0');
select throws_ok($$ select apply_agent_change('83000000-0000-0000-0000-000000000005') $$, 'P0001', null,
  'another org cannot approve');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000083a0');
select throws_ok($$ update agent_changes set status = 'approved' where id = '83000000-0000-0000-0000-000000000005' $$,
  'P0001', null, 'status cannot be set to approved without applying');
select throws_ok($$ update agent_changes set after = '{"phone": "999"}' where id = '83000000-0000-0000-0000-000000000005' $$,
  'P0001', null, 'proposal content is immutable');
update agent_changes set status = 'rejected', reviewed_at = now() where id = '83000000-0000-0000-0000-000000000005';
select throws_ok($$ select apply_agent_change('83000000-0000-0000-0000-000000000005') $$, 'P0001', null,
  'a rejected proposal cannot be applied');
select throws_ok($$ update agent_changes set status = 'pending' where id = '83000000-0000-0000-0000-000000000005' $$,
  'P0001', null, 'a decision is final');
reset role;

-- ---- action: create_revenue_plan through approval ----------------------------
insert into agent_changes (id, org_id, table_name, operation, after, action, params, requested_by)
values ('83000000-0000-0000-0000-000000000006', pg_temp.org_a(), 'revenue_plans', 'action',
  '{"name": "Εκτίμηση"}', 'create_revenue_plan',
  '{"name": "Εκτίμηση", "start_year": 2027, "years": 1, "room_types": [
     {"name": "Junior Suite", "unit_count": 8, "assumptions": [
       {"year_number": 1, "month_number": 1, "occupancy_pct": 0.6, "adr": 100},
       {"year_number": 1, "month_number": 2, "occupancy_pct": 0.5, "adr": 90}]}]}',
  '00000000-0000-0000-0000-0000000083a0');
select is((select count(*)::int from revenue_plans where org_id = pg_temp.org_a()), 0, 'nothing exists before approval');
select pg_temp.as_user('00000000-0000-0000-0000-0000000083a0');
select is(apply_agent_change('83000000-0000-0000-0000-000000000006') ->> 'status', 'approved', 'revenue-plan action applies');
reset role;
select is((select count(*)::int from revenue_plan_assumptions a join revenue_plan_room_types r on r.id = a.room_type_id
           join revenue_plans p on p.id = r.revenue_plan_id where p.org_id = pg_temp.org_a()), 2,
  'plan, room type and assumptions were created');
select ok((select result ->> 'row_id' from agent_changes where id = '83000000-0000-0000-0000-000000000006') is not null,
  'the new plan id is recorded');

select * from finish();
rollback;
