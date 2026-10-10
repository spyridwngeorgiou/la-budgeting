-- «Να γίνουν» (0087): v_worklist has all three tiers for an org with open
-- checks, overdue rows of any month count, orgs.cash_buffer drives the
-- forecast's buffer (with the settings fallback), and neither another org
-- nor a project partner sees a single row.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000087a1', 'owner87@test.local'),
  ('00000000-0000-0000-0000-0000000087b1', 'other87@test.local');
create temp table t_ctx as
  select (select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000087a1') as org_a,
         (select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000087b1') as org_b;
grant select on t_ctx to authenticated;

select has_column('public', 'orgs', 'cash_buffer', 'orgs.cash_buffer exists');

-- A project with no budget (tier 3), and a partner on it.
insert into projects (id, org_id, code, display_name, business_model)
select '00000000-0000-0000-0000-0000000087f1', org_a, 'W1', 'Έργο', 'client_project' from t_ctx;
insert into project_invites (project_id, email, role)
values ('00000000-0000-0000-0000-0000000087f1', 'partner87@test.local', 'contributor');
insert into auth.users (id, email, invited_at)
values ('00000000-0000-0000-0000-0000000087c1', 'partner87@test.local', now());

-- 10.000 in the bank: below the default 50.000 buffer (tier 1).
insert into accounts (org_id, name, kind, owner_scope, is_liquid, opening_balance, opening_balance_date)
select org_a, 'Τράπεζα', 'bank', 'corporate', true, 10000, '2026-01-01' from t_ctx;

-- A supplier bill overdue since five months ago, and one due last week:
-- both count, whatever the month (tier 1).
insert into transactions (org_id, tx_date, due_date, direction, status, gross_amount, description, project_id)
select org_a, athens_today() - 160, athens_today() - 150, 'expense', 'pending', 300, 'Παλιό ληξιπρόθεσμο',
       '00000000-0000-0000-0000-0000000087f1' from t_ctx;
insert into transactions (org_id, tx_date, due_date, direction, status, gross_amount, description, project_id)
select org_a, athens_today() - 10, athens_today() - 7, 'expense', 'pending', 200, 'Πρόσφατο ληξιπρόθεσμο',
       '00000000-0000-0000-0000-0000000087f1' from t_ctx;
-- Not overdue: due next week.
insert into transactions (org_id, tx_date, due_date, direction, status, gross_amount, description, project_id)
select org_a, athens_today(), athens_today() + 7, 'expense', 'pending', 999, 'Μελλοντικό',
       '00000000-0000-0000-0000-0000000087f1' from t_ctx;
-- Withholding on an income (tier 2).
insert into transactions (org_id, tx_date, direction, status, gross_amount, withholding_amount, description, project_id)
select org_a, athens_today() - 3, 'income', 'paid', 1000, 50, 'Είσπραξη με παρακράτηση',
       '00000000-0000-0000-0000-0000000087f1' from t_ctx;

-- Org B: one overdue bill of its own (and no buffer, so no cash warning).
update orgs set cash_buffer = 0 where id = (select org_b from t_ctx);
insert into transactions (org_id, tx_date, due_date, direction, status, gross_amount, description)
select org_b, athens_today() - 40, athens_today() - 30, 'expense', 'pending', 77, 'Άλλος οργανισμός' from t_ctx;

-- ---- as the owner of org A -------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000087a1');

select is(
  (select array_agg(distinct tier order by tier) from v_worklist)::text, '{1,2,3}',
  'all three tiers present');
select is(
  (select array[count::text, amount::text] from v_worklist where code = 'overdue_payables'),
  array['2', '-500.00'], 'both overdue bills, of any month, counted and signed');
select ok(
  (select href from v_worklist where code = 'overdue_payables') like '/transactions?ids=%',
  'overdue links to the rows themselves');
select is((select tier from v_worklist where code = 'withholding_on_income'), 2, 'withholding on income is tier 2');
select is((select tier from v_worklist where code = 'projects_without_budget'), 3, 'a project without budget is tier 3');
select is((select count(*)::int from v_worklist where code = 'below_buffer'), 1, 'below the default 50.000 buffer');
select is_empty($$ select 1 from v_worklist where org_id <> (select org_a from t_ctx) $$,
  'org A sees only its own rows');
select is_empty($$ select 1 from v_worklist where count <= 0 $$, 'no empty checks');
reset role;

-- The column wins over the legacy setting; null falls back to it.
update orgs set cash_buffer = 0, settings = settings || '{"min_cash_buffer": 999999}'::jsonb
where id = (select org_a from t_ctx);
select pg_temp.as_user('00000000-0000-0000-0000-0000000087a1');
select is((select count(*)::int from v_worklist where code = 'below_buffer'), 0,
  'cash_buffer = 0: never below the buffer');
reset role;
update orgs set cash_buffer = null, settings = settings || '{"min_cash_buffer": 5000}'::jsonb
where id = (select org_a from t_ctx);
select pg_temp.as_user('00000000-0000-0000-0000-0000000087a1');
select is((select org_cash_buffer((select org_a from t_ctx)))::int, 5000,
  'cash_buffer null: the settings value applies');
reset role;

-- ---- outsiders -----------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000087b1');
select is(
  (select array[count(*) filter (where org_id <> (select org_b from t_ctx)),
                count(*) filter (where code = 'overdue_payables' and count = 1)]::int[] from v_worklist),
  array[0, 1], 'org B sees only its own rows, with its one overdue bill');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000087c1');
select is((select count(*)::int from v_worklist), 0, 'a project partner sees 0 worklist rows');
reset role;

select * from finish();
rollback;
