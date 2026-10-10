-- VAT position (0064): credit carry-forward, locked filed periods, quarterly.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000064a1', 'vat@test.local');
create temp table t_ctx as
  select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000064a1';
grant select on t_ctx to authenticated;

-- nets +50, -100, +80 (Jan, Feb, Mar 2026)
insert into transactions (org_id, tx_date, direction, status, gross_amount, net_amount, vat_amount, has_invoice)
select org_id, d::date, dir::tx_direction, 'pending', g, n, v, true from t_ctx,
  (values ('2026-01-10', 'income', 250, 200, 50),
          ('2026-02-10', 'expense', 500, 400, 100),
          ('2026-03-10', 'income', 400, 320, 80)) as x(d, dir, g, n, v);

select pg_temp.as_user('00000000-0000-0000-0000-0000000064a1');

select is(
  array(select payable_after_credit::numeric from v_vat_position order by period_start),
  array[50, 0, 0]::numeric[],
  '+50/-100/+80: payable 50/0/0 (the 50 already paid is not available against the later credit)');
select is(
  array(select credit_balance::numeric from v_vat_position order by period_start),
  array[0, -100, -20]::numeric[],
  'credit carried forward -100 then -20');
select is((select bool_or(is_locked) from v_vat_position), false, 'nothing locked yet');

-- Quarterly regime: one Q1 period, deadline end of April.
reset role;
update orgs set settings = settings || '{"vat_period": "quarterly"}' where id = (select org_id from t_ctx);
select pg_temp.as_user('00000000-0000-0000-0000-0000000064a1');
select is((select count(*)::int from v_vat_position), 1, 'quarterly: Jan-Mar fold into one period');
select is(
  (select array[period_start::text, round(payable_after_credit)::text, filing_deadline::text, period_months::text] from v_vat_position),
  array['2026-01-01', '30', '2026-04-30', '3'],
  'quarterly: Q1 net +30 payable, due 30 April');

-- Back to monthly; January is filed with its snapshot, then a late January
-- invoice arrives. January keeps what was filed; the extra 10 lands in
-- February, the first open period.
reset role;
update orgs set settings = settings - 'vat_period' where id = (select org_id from t_ctx);
insert into vat_periods (org_id, period_start, period_end, status, filed_on, locked, locked_vat_income, locked_vat_expense)
select org_id, '2026-01-01', '2026-01-31', 'filed', '2026-02-20', true, 50, 0 from t_ctx;
insert into transactions (org_id, tx_date, direction, status, gross_amount, net_amount, vat_amount, has_invoice)
select org_id, '2026-01-20', 'income', 'pending', 50, 40, 10, true from t_ctx;
select pg_temp.as_user('00000000-0000-0000-0000-0000000064a1');

select is(
  (select array[vat_income::numeric, is_locked::int::numeric] from v_vat_position where period_start = '2026-01-01'),
  array[50, 1]::numeric[],
  'locked January still shows the filed 50');
select is(
  (select net_position::numeric from v_vat_position where period_start = '2026-02-01'),
  -90::numeric,
  'the late +10 is carried into February');
select is(
  array(select payable_after_credit::numeric from v_vat_position order by period_start),
  array[50, 0, 0]::numeric[],
  'payables after the late invoice: 50/0/0');
select is(
  (select credit_balance::numeric from v_vat_position where period_start = '2026-03-01'),
  -10::numeric,
  'remaining credit -10');
reset role;

select * from finish();
rollback;
