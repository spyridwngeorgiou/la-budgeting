-- Report fixes (0090): withholding owed is a forecast outflow next month;
-- v_withholding_position leaves out scheduled rows and is security invoker;
-- v_account_balances is on the Athens date; VAT splits issued/scheduled and
-- a VAT payment already in the ledger is not counted twice (forecast and
-- net worth); the two new quality checks catch their examples and reach
-- v_worklist; another org sees none of it.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000090a1', 'owner90@test.local'),
  ('00000000-0000-0000-0000-0000000090b1', 'other90@test.local');
create temp table t_ctx as
  select (select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000090a1') as org_a,
         (select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000090b1') as org_b,
         date_trunc('month', athens_today()::timestamp)::date as m0,
         (date_trunc('month', athens_today()::timestamp) - interval '1 month')::date as mprev;
grant select on t_ctx to authenticated;

-- ── withholding ──────────────────────────────────────────────────────────────
-- Last month: paid 100 + pending-with-invoice 50 count; scheduled 70 and
-- cancelled 30 do not. This month: paid 40.
insert into transactions (org_id, tx_date, paid_on, direction, status, has_invoice, gross_amount, withholding_amount, description)
select org_a, mprev + 5, mprev + 5, 'expense', 'paid', true, 900, 100, 'Αμοιβή πληρωμένη' from t_ctx;
insert into transactions (org_id, tx_date, due_date, direction, status, has_invoice, gross_amount, withholding_amount, description)
select org_a, mprev + 6, m0 + 40, 'expense', 'pending', true, 450, 50, 'Αμοιβή εκκρεμής' from t_ctx;
insert into transactions (org_id, tx_date, direction, status, has_invoice, gross_amount, withholding_amount, description)
select org_a, mprev + 7, 'expense', 'scheduled', true, 630, 70, 'Αμοιβή προγραμματισμένη' from t_ctx;
insert into transactions (org_id, tx_date, direction, status, has_invoice, gross_amount, withholding_amount, description)
select org_a, mprev + 8, 'expense', 'cancelled', true, 270, 30, 'Αμοιβή ακυρωμένη' from t_ctx;
insert into transactions (org_id, tx_date, paid_on, direction, status, has_invoice, gross_amount, withholding_amount, description)
select org_a, m0, m0, 'expense', 'paid', true, 360, 40, 'Αμοιβή τρέχουσα' from t_ctx;

-- ── VAT ──────────────────────────────────────────────────────────────────────
-- Last month: an invoice with 240 VAT (issued). This month: a scheduled
-- sale with 120 VAT (forecast).
insert into transactions (org_id, tx_date, due_date, direction, status, has_invoice, gross_amount, net_amount, vat_amount, description)
select org_a, mprev + 10, m0 + 200, 'income', 'pending', true, 1240, 1000, 240, 'Τιμολόγιο πώλησης' from t_ctx;
insert into transactions (org_id, tx_date, due_date, direction, status, has_invoice, gross_amount, net_amount, vat_amount, description)
select org_a, m0, m0 + 200, 'income', 'scheduled', true, 620, 500, 120, 'Προγραμματισμένη πώληση' from t_ctx;
insert into categories (id, org_id, code, name, cost_treatment)
select '00000000-0000-0000-0000-0000000090c1', org_a, 'ΦΠΑ_90', 'Πληρωμή ΦΠΑ', 'vat' from t_ctx;

-- ── account on the Athens date ───────────────────────────────────────────────
insert into accounts (id, org_id, name, kind, owner_scope, is_liquid, opening_balance, opening_balance_date)
select '00000000-0000-0000-0000-0000000090d1', org_a, 'Τράπεζα', 'bank', 'corporate', true, 1000, '2026-01-01' from t_ctx;
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, account_id, description)
select org_a, athens_today(), athens_today(), 'income', 'paid', 10, '00000000-0000-0000-0000-0000000090d1', 'Σήμερα' from t_ctx;

-- ── expected vs scheduled ────────────────────────────────────────────────────
insert into expected_income (org_id, source, amount, expected_month, probability)
select org_a, 'Πελάτης Χ', 5000, (m0 + interval '2 months')::date, 0.8 from t_ctx;
insert into transactions (org_id, tx_date, due_date, direction, status, gross_amount, description)
select org_a, (m0 + interval '2 months')::date, (m0 + interval '2 months 5 days')::date, 'income', 'scheduled', 5000, 'Δόση πελάτη Χ' from t_ctx;
-- not a duplicate: different month
insert into expected_income (org_id, source, amount, expected_month, probability)
select org_a, 'Πελάτης Ψ', 3000, (m0 + interval '3 months')::date, 0.5 from t_ctx;

-- ── loan without interest ────────────────────────────────────────────────────
insert into loans (id, org_id, label, principal, interest_rate, term_years, state)
select '00000000-0000-0000-0000-0000000090e1', org_a, 'Δάνειο', 50000, 0.04, 10, 'approved' from t_ctx;
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, loan_id, description)
select org_a, mprev + 1, mprev + 1, 'expense', 'paid', 500, '00000000-0000-0000-0000-0000000090e1', 'Δόση χωρίς τόκο' from t_ctx;
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, interest_amount, loan_id, description)
select org_a, mprev + 2, mprev + 2, 'expense', 'paid', 500, 120, '00000000-0000-0000-0000-0000000090e1', 'Δόση με τόκο' from t_ctx;
insert into transactions (org_id, tx_date, direction, status, gross_amount, loan_id, description)
select org_a, (m0 + interval '1 month')::date, 'expense', 'scheduled', 500, '00000000-0000-0000-0000-0000000090e1', 'Μελλοντική δόση' from t_ctx;

-- ── org B: its own withholding ───────────────────────────────────────────────
insert into transactions (org_id, tx_date, paid_on, direction, status, has_invoice, gross_amount, withholding_amount, description)
select org_b, mprev + 5, mprev + 5, 'expense', 'paid', true, 90, 10, 'Άλλος οργανισμός' from t_ctx;

-- ---- as the owner of org A -------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000090a1');

select is(
  array(select withheld_total::numeric from v_withholding_position order by period_start),
  array[150, 40]::numeric[], 'withholding: paid + invoiced pending only, scheduled and cancelled left out');
select is(
  array(select month::text || ':' || amount::numeric::text from v_cash_forecast_items where source = 'withholding' order by month),
  array[(select m0::text from t_ctx) || ':150.00', (select (m0 + interval '1 month')::date::text from t_ctx) || ':40.00'],
  'withholding owed is an outflow in the month after');
select is(
  (select direction::text from v_cash_forecast_items where source = 'withholding' limit 1), 'expense',
  'withholding is an expense');
select ok(
  (select round(weighted_amount) from cash_forecast_items((select org_a from t_ctx), (select m0 from t_ctx))
   where source = 'withholding') = 150,
  'cash_forecast_items carries the withholding');
select is_empty($$
  select 1 from cash_forecast((select org_a from t_ctx), 3) f
  where f.outflow <> (select coalesce(sum(i.amount), 0) from v_cash_forecast_items i
                      where i.month = f.month and i.direction = 'expense')
$$, 'cash_forecast outflows include every expense item, withholding too');

select is(
  array(select net_issued::int || '/' || net_scheduled::int from v_vat_position
        where vat_income <> 0 or vat_expense <> 0 order by period_start),
  array['240/0', '0/120'], 'VAT: issued and scheduled apart');
select is_empty($$ select 1 from v_vat_position where net_issued + net_scheduled <> net_position $$,
  'issued + scheduled = net position');
select is(
  array(select month::text || ':' || amount::int from v_cash_forecast_items where source = 'vat' order by month),
  array[(select m0::text from t_ctx) || ':240', (select (m0 + interval '1 month')::date::text from t_ctx) || ':120'],
  'VAT: both periods forecast before any payment is entered');
select is((select round(vat_total)::int from v_net_worth), -360, 'net worth: both VAT payables owed');

select is(
  (select array[current_balance::int, projected_balance::int] from v_account_balances
   where account_id = '00000000-0000-0000-0000-0000000090d1'),
  array[1010, 1010], 'a payment dated today (Athens) is in the current balance');

select is(
  (select array[source, expected_amount::int::text, tx_amount::int::text] from v_qc_expected_vs_scheduled),
  array['Πελάτης Χ', '5000', '5000'], 'expected vs scheduled: the same 5.000 found once, the other month ignored');
select is(
  array(select loan_label || ':' || gross_amount::int from v_qc_loan_without_interest),
  array['Δάνειο:500'], 'loan without interest: only the paid row without interest');
select is((select array[tier, count] from v_worklist where code = 'expected_vs_scheduled'), array[1, 1],
  'worklist: expected vs scheduled, tier 1');
select is((select array[tier, count] from v_worklist where code = 'loan_without_interest'), array[2, 1],
  'worklist: loan without interest, tier 2');
reset role;

-- The VAT of last month paid by a ledger row due this month: that period is
-- no longer forecast (the row itself is), nor owed again in net worth.
insert into transactions (org_id, tx_date, due_date, direction, status, gross_amount, category_id, description)
select org_a, m0, (m0 + interval '20 days')::date, 'expense', 'pending', 240, '00000000-0000-0000-0000-0000000090c1', 'Πληρωμή ΦΠΑ' from t_ctx;
-- Last month's withholding marked paid at the tax office.
insert into withholding_periods (org_id, period_start, period_end, status, paid_on)
select org_a, mprev, (m0 - 1), 'paid', m0 from t_ctx;

select pg_temp.as_user('00000000-0000-0000-0000-0000000090a1');
select is(
  array(select month::text from v_cash_forecast_items where source = 'vat' order by month),
  array[(select (m0 + interval '1 month')::date::text from t_ctx)], 'VAT paid in the ledger: that period not forecast again');
select is(
  (select count(*)::int from v_cash_forecast_items where label = 'Πληρωμή ΦΠΑ' and source = 'open'), 1,
  'the VAT payment row itself is the outflow');
select is((select round(vat_total)::int from v_net_worth), -120, 'net worth: the ledger-paid VAT is not owed twice');
select is(
  array(select month::text from v_cash_forecast_items where source = 'withholding' order by month),
  array[(select (m0 + interval '1 month')::date::text from t_ctx)], 'a withholding period marked paid leaves the forecast');
reset role;

-- ── views are security invoker ───────────────────────────────────────────────
select ok(
  (select bool_and(coalesce('security_invoker=true' = any(reloptions), false)) from pg_class
   where relname in ('v_withholding_position', 'v_qc_expected_vs_scheduled', 'v_qc_loan_without_interest',
                     'v_account_balances', 'v_vat_position', 'v_cash_forecast_items')),
  'every touched view is security invoker');
select ok(pg_get_viewdef('v_account_balances'::regclass) like '%athens_today()%',
  'v_account_balances uses the Athens date');

-- ---- another org -----------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000090b1');
select is(
  (select array_agg(withheld_total::int) from v_withholding_position), array[10],
  'org B sees only its own withholding');
select is(
  (select count(*) from v_qc_expected_vs_scheduled) + (select count(*) from v_qc_loan_without_interest)
  + (select count(*) from v_cash_forecast_items where org_id = (select org_a from t_ctx))
  + (select count(*) from v_worklist where org_id = (select org_a from t_ctx)),
  0::bigint, 'org B sees none of org A''s checks, forecast or worklist');
reset role;

select * from finish();
rollback;
