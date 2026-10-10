-- P&L (0067): net of VAT, construction cost by business model, only the
-- interest of a loan payment, principal/equity out, scheduled rows flagged,
-- the rollup's new columns, and nobody outside the org sees a line.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000067a1', 'owner67@test.local'),
  ('00000000-0000-0000-0000-0000000067b1', 'other67@test.local');
create temp table t_ctx as
  select org_id as org_a, date_trunc('month', athens_today()::timestamp)::date as m0
  from org_members where user_id = '00000000-0000-0000-0000-0000000067a1';
grant select on t_ctx to authenticated;

-- C: a client project (construction is cost of sales); D: an own development
-- (construction builds an asset and stays out of the P&L).
insert into projects (id, org_id, code, display_name, business_model)
select '00000000-0000-0000-0000-0000000067c1', org_a, 'C67', 'Έργο πελάτη', 'client_project' from t_ctx;
insert into projects (id, org_id, code, display_name, business_model)
select '00000000-0000-0000-0000-0000000067d1', org_a, 'D67', 'Ιδιοανάπτυξη', 'own_development' from t_ctx;

insert into project_invites (project_id, email, role)
values ('00000000-0000-0000-0000-0000000067c1', 'partner67@test.local', 'contributor');
insert into auth.users (id, email, invited_at)
values ('00000000-0000-0000-0000-0000000067e1', 'partner67@test.local', now());

insert into categories (org_id, code, name, cost_treatment)
select org_a, v.code, v.code, v.t::cost_treatment from t_ctx
cross join (values ('T67_CAPEX', 'capex'), ('T67_OPEX', 'opex'), ('T67_PRINCIPAL', 'principal'),
                   ('T67_EQUITY', 'equity'), ('T67_INCOME', 'income')) v(code, t);
create temp table t_cat as select code, id from categories where code like 'T67_%';
grant select on t_cat to authenticated;

-- 1. invoiced income on C: 1.240 gross, 240 VAT -> revenue 1.000
insert into transactions (org_id, tx_date, direction, status, gross_amount, net_amount, vat_amount, has_invoice,
                          project_id, category_id, description)
select org_a, m0, 'income', 'pending', 1240, 1000, 240, true, '00000000-0000-0000-0000-0000000067c1',
       (select id from t_cat where code = 'T67_INCOME'), 'Τιμολόγιο πελάτη' from t_ctx;
-- 2. construction on C, no net_amount recorded: 620 - 120 VAT -> cost of sales 500
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, vat_amount, has_invoice,
                          project_id, category_id, description)
select org_a, m0, m0, 'expense', 'paid', 620, 120, true, '00000000-0000-0000-0000-0000000067c1',
       (select id from t_cat where code = 'T67_CAPEX'), 'Υλικά πελάτη' from t_ctx;
-- 3. construction on D: capitalised, not a result
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, project_id, category_id, description)
select org_a, m0, m0, 'expense', 'paid', 300, '00000000-0000-0000-0000-0000000067d1',
       (select id from t_cat where code = 'T67_CAPEX'), 'Υλικά ιδιοανάπτυξης' from t_ctx;
-- 4. principal and equity: balance-sheet flows
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, category_id, description)
select org_a, m0, m0, 'expense', 'paid', 1000, (select id from t_cat where code = 'T67_PRINCIPAL'), 'Κεφάλαιο' from t_ctx;
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, category_id, description)
select org_a, m0, m0, 'income', 'paid', 5000, (select id from t_cat where code = 'T67_EQUITY'), 'Εισφορά' from t_ctx;
-- 5. scheduled opex on C
insert into transactions (org_id, tx_date, direction, status, gross_amount, project_id, category_id, description)
select org_a, (m0 + interval '1 month')::date, 'expense', 'scheduled', 200, '00000000-0000-0000-0000-0000000067c1',
       (select id from t_cat where code = 'T67_OPEX'), 'Προγραμματισμένο' from t_ctx;
-- 6. a loan instalment of 500, of which 150 interest (via the schedule sync)
insert into loans (id, org_id, project_id, label, principal, interest_rate, term_years, state)
select '00000000-0000-0000-0000-0000000067f1', org_a, '00000000-0000-0000-0000-0000000067c1', 'Δάνειο 67',
       50000, 0.04, 10, 'approved' from t_ctx;
select pg_temp.as_user('00000000-0000-0000-0000-0000000067a1');
select * from sync_schedule_rows('loan', '00000000-0000-0000-0000-0000000067f1',
  json_build_array(json_build_object('seq', 1, 'due_date', (select (m0 + interval '2 months')::date from t_ctx),
                                     'amount', 500, 'interest', 150))::jsonb);
reset role;
-- 7. cancelled: never a result
insert into transactions (org_id, tx_date, direction, status, gross_amount, category_id)
select org_a, m0, 'income', 'cancelled', 999, (select id from t_cat where code = 'T67_INCOME') from t_ctx;

-- ---- as the owner --------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000067a1');

select is((select count(*)::int from v_pnl_lines), 4, 'four P&L lines: revenue, cost of sales, opex, interest');
select is((select array[line, amount::text] from v_pnl_lines where direction = 'income'),
  array['revenue', '1000.00'], 'revenue is net of VAT');
select is((select array[line, amount::text] from v_pnl_lines where project_id = '00000000-0000-0000-0000-0000000067c1'
                                                         and treatment = 'capex'),
  array['cost_of_sales', '500.00'], 'construction on a client project: cost of sales, net (gross - VAT)');
select is((select count(*)::int from v_pnl_lines where project_id = '00000000-0000-0000-0000-0000000067d1'), 0,
  'construction on an own development stays out of the P&L');
select is((select array[line, amount::text, is_scheduled::text] from v_pnl_lines where line = 'financing'),
  array['financing', '150.00', 'true'], 'a loan instalment contributes only its interest, flagged scheduled');
select is((select count(*)::int from v_pnl_lines where treatment in ('principal', 'equity')), 0,
  'principal and equity are not results');
select is((select pnl_line('vat', 'client_project', 'expense')), null, 'pnl_line: VAT is not a result');
select is((select pnl_line('capex', 'hotel_lease', 'expense')), null, 'pnl_line: capex on a hotel lease is capitalised');
select is((select round(sum(amount))::int from v_pnl_monthly), 1000 - 500 - 200 - 150,
  'v_pnl_monthly sums to the lines (signed)');
select is(
  (select array[net_result::int, lifetime_result::int] from v_project_rollup
   where project_id = '00000000-0000-0000-0000-0000000067c1'),
  array[500, 150], 'rollup: net_result booked so far, lifetime_result with scheduled');
select is((select round(sum(amount))::int from pnl_summary((select org_a from t_ctx), (select m0 from t_ctx),
            (select (m0 + interval '1 year')::date from t_ctx))), 500,
  'pnl_summary: booked only by default (1.000 - 500)');
select is((select round(sum(amount))::int from pnl_summary((select org_a from t_ctx), (select m0 from t_ctx),
            (select (m0 + interval '1 year')::date from t_ctx), 'business_line', true)
           where bucket = 'construction'), 150,
  'pnl_summary by business line, with scheduled');
select is((select business_line::text from v_project_rollup where project_id = '00000000-0000-0000-0000-0000000067c1'),
  'construction', 'rollup carries the business line');
reset role;

-- ---- outsiders ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000067e1');
select is(
  (select count(*) from v_pnl_lines) + (select count(*) from v_pnl_monthly) + (select count(*) from v_project_rollup),
  0::bigint, 'a project partner sees 0 P&L rows');
select is((select count(*)::int from pnl_summary((select org_a from t_ctx), '2000-01-01', '2100-01-01', 'month', true)), 0,
  'a project partner gets an empty pnl_summary');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000067b1');
select is(
  (select count(*) from v_pnl_lines) + (select count(*) from v_pnl_monthly)
  + (select count(*) from v_project_rollup where org_id = (select org_a from t_ctx)),
  0::bigint, 'another org sees 0 P&L rows of org A');
reset role;

select * from finish();
rollback;
