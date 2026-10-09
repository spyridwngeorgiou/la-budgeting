-- Org isolation through views + static RLS invariants (0036).
-- Run: supabase test db   (CI: .github/workflows/ci.yml, job "db")
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

-- Two signups -> handle_new_user gives each their own org as owner.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local');

create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
grant select on t_org to authenticated;

insert into accounts (org_id, name, owner_scope, opening_balance, opening_balance_date)
select org_id, 'Λογαριασμός A', 'corporate', 1000, '2026-01-01' from t_org
where user_id = '00000000-0000-0000-0000-00000000000a';
insert into contacts (org_id, name)
select org_id, 'Επαφή A' from t_org
where user_id = '00000000-0000-0000-0000-00000000000a';

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- User A sees their own rows through views.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select count(*) from v_account_balances)::int, 1, 'A sees own account balance');
select is((select count(*) from v_contact_rollup)::int, 1, 'A sees own contact rollup');
select is((select count(*) from v_net_worth)::int, 1, 'A sees only own org net worth');

-- User B sees nothing of A's, via views or tables.
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is((select count(*) from v_account_balances)::int, 0, 'B cannot read A balances via view');
select is((select count(*) from v_contact_rollup)::int, 0, 'B cannot read A contacts via view');
select is((select count(*) from accounts)::int, 0, 'B cannot read A accounts table');
select is(
  (select count(*) from v_net_worth
   where org_id = (select org_id from t_org where user_id = '00000000-0000-0000-0000-00000000000a'))::int,
  0, 'B cannot read A net worth');
reset role;

-- Static invariants: every public view honours the caller's RLS, every
-- public table has RLS on, and privileged functions are a reviewed list.
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not coalesce(c.reloptions @> array['security_invoker=true'], false)
$$, 'every public view is security_invoker');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
$$, 'every public table has RLS enabled');

-- Compared as plain text arrays: results_eq over an `order by ... collate`
-- query fails with "could not determine which collation to use".
select is(
  array(
    select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef order by p.proname::text collate "C"
  ),
  array[
    'broadcast_board_comment', 'broadcast_project_message', 'can_access_project', 'can_edit_collab',
    'can_manage_collab', 'collab_ai_budget_check', 'collab_path_manage_ok', 'collab_path_ok',
    'collab_people', 'collab_project_org', 'ensure_plans_current', 'handle_new_user', 'has_role',
    'is_internal_user', 'log_collab_ai_usage', 'log_project_activity', 'log_transaction_history',
    'my_collab_projects',
    'my_org_ids', 'planner_can_read', 'planner_can_write', 'planner_guard',
    'planner_people', 'planner_projects', 'realtime_board_topic_ok', 'realtime_project_topic_ok',
    'regenerate_plan', 'regenerate_plan_unchecked'
  ]::text[],
  'SECURITY DEFINER functions match the reviewed allowlist');

select ok(not has_function_privilege('authenticated', 'public.ensure_plans_current(uuid)', 'execute'),
  'authenticated cannot run ensure_plans_current');
select ok(not has_function_privilege('authenticated', 'public.regenerate_plan_unchecked(uuid)', 'execute'),
  'authenticated cannot bypass the regenerate_plan role check');

select * from finish();
rollback;
