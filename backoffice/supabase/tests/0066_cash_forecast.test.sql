-- Cash forecast (0066): every source once, overdue lands in the current
-- month, the three scenarios, closing = opening + net, and nobody outside
-- the org (a project partner, another org) sees a single row.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(19);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000066a1', 'owner66@test.local'),
  ('00000000-0000-0000-0000-0000000066b1', 'other66@test.local');
create temp table t_ctx as
  select org_id as org_a, date_trunc('month', athens_today()::timestamp)::date as m0
  from org_members where user_id = '00000000-0000-0000-0000-0000000066a1';
grant select on t_ctx to authenticated;

insert into projects (id, org_id, code, display_name, business_model)
select '00000000-0000-0000-0000-0000000066f1', org_a, 'F1', 'Έργο πελάτη', 'client_project' from t_ctx;

-- A partner on that project (invite -> signup, as in 0037).
insert into project_invites (project_id, email, role)
values ('00000000-0000-0000-0000-0000000066f1', 'partner66@test.local', 'contributor');
insert into auth.users (id, email, invited_at)
values ('00000000-0000-0000-0000-0000000066c1', 'partner66@test.local', now());

-- Cash: 10.000 in the bank; 5.000 of gold is wealth, not liquidity.
insert into accounts (org_id, name, kind, owner_scope, is_liquid, opening_balance, opening_balance_date)
select org_a, 'Τράπεζα', 'bank', 'corporate', true, 10000, '2026-01-01' from t_ctx;
insert into accounts (org_id, name, kind, owner_scope, is_liquid, opening_balance, opening_balance_date)
select org_a, 'Χρυσός', 'gold', 'personal', false, 5000, '2026-01-01' from t_ctx;

-- 1. overdue supplier bill (due 2 months ago) -> current month
insert into transactions (org_id, tx_date, due_date, direction, status, gross_amount, description, project_id)
select org_a, m0 - 70, m0 - 60, 'expense', 'pending', 300, 'Ληξιπρόθεσμο', '00000000-0000-0000-0000-0000000066f1' from t_ctx;
-- 2. receivable next month, 60% collectable
insert into transactions (org_id, tx_date, due_date, direction, status, gross_amount, description, collection_probability)
select org_a, m0, (m0 + interval '1 month 5 days')::date, 'income', 'pending', 1000, 'Είσπραξη', 0.6 from t_ctx;
-- 3. expected income in two months, probability 0,5
insert into expected_income (org_id, source, amount, expected_month, probability)
select org_a, 'Αναμενόμενο', 2000, (m0 + interval '2 months')::date, 0.5 from t_ctx;
-- 4. a deal at offer stage: 100.000 × 2% = 2.000, weight 0,3
insert into brokerage_deals (org_id, property_label, price, commission_pct, stage, expected_close_date)
select org_a, 'Διαμέρισμα', 100000, 0.02, 'offer', (m0 + interval '2 months 10 days')::date from t_ctx;
-- 5. a loan drawdown next month, and a scheduled instalment in three months
insert into loans (id, org_id, project_id, label, principal, interest_rate, term_years, state)
select '00000000-0000-0000-0000-0000000066d1', org_a, '00000000-0000-0000-0000-0000000066f1', 'Δάνειο', 50000, 0.04, 10, 'approved' from t_ctx;
insert into loan_drawdowns (org_id, loan_id, scheduled_month, amount)
select org_a, '00000000-0000-0000-0000-0000000066d1', (m0 + interval '1 month')::date, 4000 from t_ctx;
select pg_temp.as_user('00000000-0000-0000-0000-0000000066a1');
select * from sync_schedule_rows('loan', '00000000-0000-0000-0000-0000000066d1',
  json_build_array(json_build_object('seq', 1, 'due_date', (select (m0 + interval '3 months')::date from t_ctx),
                                     'amount', 500, 'interest', 150))::jsonb);
reset role;
-- 6. a private liability maturing in four months
insert into liabilities (org_id, lender, principal, maturity_date, state, owner_scope)
select org_a, 'Ιδιώτης', 700, (m0 + interval '4 months')::date, 'disbursed', 'personal' from t_ctx;
-- noise that must NOT appear: a cancelled row, a paid row in the past, a lost deal
insert into transactions (org_id, tx_date, direction, status, gross_amount)
select org_a, m0, 'expense', 'cancelled', 999 from t_ctx;
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, account_id)
select org_a, '2026-01-05', '2026-01-05', 'income', 'paid', 100, (select id from accounts where name = 'Τράπεζα' and org_id = org_a) from t_ctx;
insert into brokerage_deals (org_id, property_label, price, stage, expected_close_date)
select org_a, 'Χαμένο', 100000, 'lost', (m0 + interval '1 month')::date from t_ctx;

-- ---- as the owner --------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000066a1');

select is((select count(*)::int from v_cash_forecast_items), 7, 'seven forecast items, one per source row');
select is_empty($$ select item_key from v_cash_forecast_items group by item_key having count(*) > 1 $$,
  'no item appears twice');
select is(
  (select array_agg(distinct source order by source) from v_cash_forecast_items)::text,
  '{deal,drawdown,expected,liability,loan,open}', 'every source represented');
select is(
  (select array[month::text, is_overdue::text] from v_cash_forecast_items where label = 'Ληξιπρόθεσμο'),
  array[(select m0::text from t_ctx), 'true'], 'an overdue bill is forecast in the current month');
select is((select round(balance)::int from v_liquidity where owner_scope = 'corporate'), 10100,
  'liquidity: opening + paid movements, liquid accounts only');
select is((select count(*)::int from v_liquidity where owner_scope = 'personal'), 0,
  'the gold account is not liquidity');

select is((select count(*)::int from cash_forecast((select org_a from t_ctx), 6)), 6, 'six months requested, six rows');
select is((select count(*)::int from cash_forecast((select org_a from t_ctx), 99)), 36, 'horizon capped at 36 months');
select is((select round(opening_balance)::int from cash_forecast((select org_a from t_ctx), 6) order by month limit 1),
  10100, 'month 1 opens at today''s liquidity');
select is_empty($$ select month from cash_forecast((select org_a from t_ctx), 12)
                   where closing_balance <> opening_balance + net or net <> inflow - outflow $$,
  'closing = opening + net in every month');
select is_empty($$ select month from (
                     select month, opening_balance, lag(closing_balance) over (order by month) as prev
                     from cash_forecast((select org_a from t_ctx), 12)) x
                   where prev is not null and opening_balance <> prev $$,
  'each month opens at the previous month''s close');

-- Month +1: receivable 1000 @ 0,6 + drawdown 4000; month +2: expected 2000 @ 0,5 + deal 2000 @ 0,3
select is(
  (select array_agg(round(inflow)::int order by month) from cash_forecast((select org_a from t_ctx), 3, 'base')),
  array[0, 4600, 1600], 'base: weighted by probability');
select is(
  (select array_agg(round(inflow)::int order by month) from cash_forecast((select org_a from t_ctx), 3, 'optimistic')),
  array[0, 5000, 4000], 'optimistic: every expected income in full');
select is(
  (select array_agg(round(inflow)::int order by month) from cash_forecast((select org_a from t_ctx), 3, 'pessimistic')),
  array[0, 4000, 0], 'pessimistic: certain income only');
select is(
  (select array_agg(round(outflow)::int order by month) from cash_forecast((select org_a from t_ctx), 5, 'base')),
  array[300, 0, 0, 500, 700], 'outflows: overdue bill now, loan instalment, liability at maturity');
select is((select round(sum(net))::int from cash_forecast((select org_a from t_ctx), 5, 'base', 'personal')), -700,
  'scope filter: personal shows only the personal liability');
select is((select round(sum(weighted_amount))::int from cash_forecast_items((select org_a from t_ctx),
            (select (m0 + interval '2 months')::date from t_ctx), 'base') where direction = 'income'),
  1600, 'cash_forecast_items agrees with cash_forecast for a month');
reset role;

-- ---- outsiders ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000066c1');
select is(
  (select count(*) from v_cash_forecast_items) + (select count(*) from v_liquidity)
  + (select count(*) from cash_forecast((select org_a from t_ctx), 12))
  + (select count(*) from cash_forecast_items((select org_a from t_ctx)))
  + (select count(*) from v_qc_forecast_stale) + (select count(*) from v_qc_schedule_stale)
  + (select count(*) from brokerage_deals),
  0::bigint, 'a project partner sees 0 forecast rows');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000066b1');
select is(
  (select count(*) from v_cash_forecast_items) + (select count(*) from v_liquidity)
  + (select count(*) from cash_forecast((select org_a from t_ctx), 12))
  + (select count(*) from cash_forecast_items((select org_a from t_ctx))),
  0::bigint, 'another org sees 0 forecast rows of org A');
reset role;

select * from finish();
rollback;
