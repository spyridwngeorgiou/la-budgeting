-- Account ledger (0091): the rows of v_account_ledger are exactly the ones
-- v_account_balances counts, in payment-date order (id breaks ties), and the
-- last running balance equals current_balance; a month filter keeps the
-- running balance from the opening; the monthly view sums them; another org
-- and a project partner see nothing.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000091a1', 'owner91@test.local'),
  ('00000000-0000-0000-0000-0000000091b1', 'other91@test.local');
create temp table t_ctx as
  select (select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000091a1') as org_a,
         (select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000091b1') as org_b;
grant select on t_ctx to authenticated;

-- A project with a partner on it (the partner must not see the ledger).
insert into projects (id, org_id, code, display_name, business_model)
select '00000000-0000-0000-0000-0000000091f1', org_a, 'L91', 'Έργο', 'client_project' from t_ctx;
insert into project_invites (project_id, email, role)
values ('00000000-0000-0000-0000-0000000091f1', 'partner91@test.local', 'contributor');
insert into auth.users (id, email, invited_at)
values ('00000000-0000-0000-0000-0000000091c1', 'partner91@test.local', now());

-- Org A: two accounts; org B: one.
insert into accounts (id, org_id, name, kind, owner_scope, is_liquid, opening_balance, opening_balance_date)
select '91000000-0000-0000-0000-0000000000a1', org_a, 'Τράπεζα 91', 'bank', 'corporate', true, 1000, '2026-01-01' from t_ctx
union all
select '91000000-0000-0000-0000-0000000000a2', org_a, 'Ταμείο 91', 'cash', 'corporate', true, 0, '2026-01-01' from t_ctx
union all
select '91000000-0000-0000-0000-0000000000b1', org_b, 'Τράπεζα Β', 'bank', 'corporate', true, 50, '2026-01-01' from t_ctx;

-- Counted (account a1), by payment date: a002 (02-03) → a001 (02-05) →
-- a003, a004 (both 03-01, id order).
insert into transactions (id, org_id, account_id, project_id, tx_date, paid_on, direction, status, gross_amount, description)
select '91000000-0000-0000-0000-00000000a001'::uuid, org_a, '91000000-0000-0000-0000-0000000000a1'::uuid,
       '00000000-0000-0000-0000-0000000091f1'::uuid, '2026-02-01'::date, '2026-02-05'::date,
       'income'::tx_direction, 'paid'::tx_status, 500, 'Είσπραξη' from t_ctx
union all
select '91000000-0000-0000-0000-00000000a002', org_a, '91000000-0000-0000-0000-0000000000a1',
       null, '2026-02-10', '2026-02-03', 'expense', 'paid', 200, 'Πληρωμή πριν το παραστατικό' from t_ctx;
insert into transactions (id, org_id, account_id, tx_date, paid_on, direction, status, has_invoice, gross_amount, vat_amount, description)
select '91000000-0000-0000-0000-00000000a003', org_a, '91000000-0000-0000-0000-0000000000a1',
       '2026-02-20', '2026-03-01', 'income', 'paid', true, 100, 16, 'Είσπραξη με ΦΠΑ' from t_ctx;
insert into transactions (id, org_id, account_id, tx_date, paid_on, direction, status, gross_amount, description)
select '91000000-0000-0000-0000-00000000a004'::uuid, org_a, '91000000-0000-0000-0000-0000000000a1'::uuid,
       '2026-03-01'::date, '2026-03-01'::date, 'expense'::tx_direction, 'paid'::tx_status, 30, 'Μικροέξοδο' from t_ctx
-- Not counted: before the opening date, pending, paid in the future.
union all
select '91000000-0000-0000-0000-00000000a005', org_a, '91000000-0000-0000-0000-0000000000a1',
       '2025-12-15', '2025-12-15', 'expense', 'paid', 40, 'Πριν την έναρξη' from t_ctx
union all
select '91000000-0000-0000-0000-00000000a006', org_a, '91000000-0000-0000-0000-0000000000a1',
       '2026-02-15', null, 'expense', 'pending', 999, 'Εκκρεμεί' from t_ctx
union all
select '91000000-0000-0000-0000-00000000a007', org_a, '91000000-0000-0000-0000-0000000000a1',
       athens_today(), athens_today() + 5, 'expense', 'paid', 77, 'Μελλοντική πληρωμή' from t_ctx
-- The other account of org A, and org B.
union all
select '91000000-0000-0000-0000-00000000a008', org_a, '91000000-0000-0000-0000-0000000000a2',
       '2026-02-01', '2026-02-01', 'income', 'paid', 70, 'Μετρητά' from t_ctx
union all
select '91000000-0000-0000-0000-00000000b001', org_b, '91000000-0000-0000-0000-0000000000b1',
       '2026-02-01', '2026-02-01', 'expense', 'paid', 20, 'Άλλος οργανισμός' from t_ctx;

-- ---- as the owner of org A -------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000091a1');

select is(
  array(select transaction_id::text from v_account_ledger
        where account_id = '91000000-0000-0000-0000-0000000000a1' order by paid_date, transaction_id),
  array['91000000-0000-0000-0000-00000000a002', '91000000-0000-0000-0000-00000000a001',
        '91000000-0000-0000-0000-00000000a003', '91000000-0000-0000-0000-00000000a004'],
  'only counted rows, by payment date then id');
select is(
  array(select signed_amount from v_account_ledger
        where account_id = '91000000-0000-0000-0000-0000000000a1' order by paid_date, transaction_id),
  array[-200, 500, 100, -30]::numeric[],
  'signed amounts');
select is(
  array(select running_balance from v_account_ledger
        where account_id = '91000000-0000-0000-0000-0000000000a1' order by paid_date, transaction_id),
  array[800, 1300, 1400, 1370]::numeric[],
  'running balance from the opening balance');
select is(
  (select running_balance from v_account_ledger
   where account_id = '91000000-0000-0000-0000-0000000000a1' order by paid_date desc, transaction_id desc limit 1),
  (select current_balance from v_account_balances where account_id = '91000000-0000-0000-0000-0000000000a1'),
  'the last running balance equals current_balance');
select is(
  (select running_balance from v_account_ledger
   where account_id = '91000000-0000-0000-0000-0000000000a2' order by paid_date desc, transaction_id desc limit 1),
  (select current_balance from v_account_balances where account_id = '91000000-0000-0000-0000-0000000000a2'),
  'and for the second account, which has its own running balance');
select is(
  array(select running_balance from v_account_ledger
        where account_id = '91000000-0000-0000-0000-0000000000a1'
          and paid_date between '2026-03-01' and '2026-03-31'
        order by paid_date, transaction_id),
  array[1400, 1370]::numeric[],
  'a month filter keeps the running balance from the opening');
select is(
  (select party_name from v_account_ledger where transaction_id = '91000000-0000-0000-0000-00000000a001'),
  null, 'no contact, no counterparty: no party name');
select is(
  array(select array[month, inflow::text, outflow::text, n::text] from v_account_ledger_monthly
        where account_id = '91000000-0000-0000-0000-0000000000a1' order by month)::text,
  '{{2026-02,500.00,200.00,2},{2026-03,100.00,30.00,2}}',
  'monthly inflow / outflow');
select is_empty($$ select 1 from v_account_ledger where org_id <> (select org_a from t_ctx) $$,
  'org A sees only its own ledger rows');
reset role;

-- ---- outsiders -----------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000091b1');
select is(
  array(select transaction_id::text from v_account_ledger),
  array['91000000-0000-0000-0000-00000000b001'],
  'org B sees only its own row');
select is_empty($$ select 1 from v_account_ledger_monthly where org_id = (select org_a from t_ctx) $$,
  'nor org A''s monthly totals');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000091c1');
select is((select count(*)::int from v_account_ledger), 0, 'a project partner sees 0 ledger rows');
reset role;

select * from finish();
rollback;
