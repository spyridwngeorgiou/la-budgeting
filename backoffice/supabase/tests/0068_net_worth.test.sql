-- Net worth (0068): every component itemised, the parts add up to the
-- total, applications and pending inheritances are not counted, and nobody
-- outside the org sees a row.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000068a1', 'owner68@test.local'),
  ('00000000-0000-0000-0000-0000000068b1', 'other68@test.local');
create temp table t_ctx as
  select org_id as org_a, athens_today() as d0
  from org_members where user_id = '00000000-0000-0000-0000-0000000068a1';
grant select on t_ctx to authenticated;

insert into projects (id, org_id, code, display_name, business_model)
select '00000000-0000-0000-0000-0000000068f1', org_a, 'N68', 'Έργο', 'client_project' from t_ctx;
insert into project_invites (project_id, email, role)
values ('00000000-0000-0000-0000-0000000068f1', 'partner68@test.local', 'contributor');
insert into auth.users (id, email, invited_at)
values ('00000000-0000-0000-0000-0000000068c1', 'partner68@test.local', now());

-- cash 10.000; gold 5.000 (other accounts)
insert into accounts (org_id, name, kind, owner_scope, is_liquid, opening_balance, opening_balance_date)
select org_a, 'Τράπεζα', 'bank', 'corporate', true, 10000, '2026-01-01' from t_ctx;
insert into accounts (org_id, name, kind, owner_scope, is_liquid, opening_balance, opening_balance_date)
select org_a, 'Χρυσός', 'gold', 'personal', false, 5000, '2026-01-01' from t_ctx;
-- assets: half of a 200.000 property; an inheritance still pending is not summed
insert into assets (org_id, name, estimated_value, ownership_pct, state)
select org_a, 'Ακίνητο', 200000, 0.5, 'held' from t_ctx;
insert into assets (org_id, name, estimated_value, state)
select org_a, 'Κληρονομιά', 80000, 'pending_inheritance' from t_ctx;
-- open receivable 1.000, open payable 300; a scheduled row is the forecast's, not here
insert into transactions (org_id, tx_date, direction, status, gross_amount, description)
select org_a, d0, 'income', 'pending', 1000, 'Απαίτηση' from t_ctx;
insert into transactions (org_id, tx_date, direction, status, gross_amount, description)
select org_a, d0, 'expense', 'pending', 300, 'Υποχρέωση' from t_ctx;
insert into transactions (org_id, tx_date, direction, status, gross_amount, description)
select org_a, d0 + 40, 'expense', 'scheduled', 777, 'Μελλοντική' from t_ctx;
-- a private loan received (700) and one still in application (999)
insert into liabilities (org_id, lender, principal, state)
select org_a, 'Ιδιώτης', 700, 'disbursed' from t_ctx;
insert into liabilities (org_id, lender, principal, state)
select org_a, 'Αίτηση', 999, 'in_application' from t_ctx;
-- a bank loan: 4.000 drawn, one instalment of 500 paid (150 interest) -> 3.650 owed
insert into loans (id, org_id, project_id, label, principal, interest_rate, term_years, state)
select '00000000-0000-0000-0000-0000000068d1', org_a, '00000000-0000-0000-0000-0000000068f1', 'Δάνειο 68',
       50000, 0.04, 10, 'disbursed' from t_ctx;
insert into loan_drawdowns (org_id, loan_id, scheduled_month, amount, actual_date, actual_amount)
select org_a, '00000000-0000-0000-0000-0000000068d1', '2026-01-01', 5000, '2026-01-10', 4000 from t_ctx;
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, interest_amount, loan_id, description)
select org_a, '2026-02-28', '2026-02-28', 'expense', 'paid', 500, 150, '00000000-0000-0000-0000-0000000068d1', 'Δόση' from t_ctx;
-- a loan still in application is not debt
insert into loans (org_id, label, principal, interest_rate, term_years, state)
select org_a, 'Αίτηση δανείου', 90000, 0.04, 10, 'in_application' from t_ctx;

-- ---- as the owner --------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000068a1');

select is((select round(cash_total)::int from v_net_worth), 10000, 'cash: liquid accounts');
select is((select round(other_accounts_total)::int from v_net_worth), 5000, 'other accounts: gold');
select is((select round(asset_total)::int from v_net_worth), 100000, 'assets × ownership, pending inheritance left out');
select is((select array[round(receivables_total)::int, round(payables_total)::int] from v_net_worth),
  array[1000, 300], 'open receivables and payables; scheduled rows are not today''s position');
select is((select round(liability_total)::int from v_net_worth), 700, 'liabilities actually received only');
select is((select round(loans_total)::int from v_net_worth), 3650, 'bank loan: drawn minus principal repaid');
select is((select round(net_worth)::int from v_net_worth), 10000 + 5000 + 100000 + 1000 - 300 - 700 - 3650,
  'net worth');
select is_empty($$
  select w.org_id from v_net_worth w
  where w.net_worth <> (select coalesce(sum(amount), 0) from v_net_worth_items i where i.org_id = w.org_id)
     or w.net_worth <> w.cash_total + w.other_accounts_total + w.asset_total + w.receivables_total
                       - w.payables_total - w.liability_total - w.loans_total + w.vat_total
     or w.liquid_total <> w.cash_total + w.other_accounts_total
$$, 'the parts add up to the total');
select is((select count(*)::int from v_net_worth), 1, 'one row: the own org');
reset role;

-- ---- outsiders ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000068c1');
select is((select count(*) from v_net_worth_items) + (select count(*) from v_net_worth),
  0::bigint, 'a project partner sees 0 net worth rows');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000068b1');
select is(
  (select count(*) from v_net_worth_items where org_id = (select org_a from t_ctx))
  + (select count(*) from v_net_worth where org_id = (select org_a from t_ctx)),
  0::bigint, 'another org sees 0 net worth rows of org A');
reset role;

select * from finish();
rollback;
