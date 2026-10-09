-- Assistant aggregates and spend are computed in SQL (0080, 0084):
-- no 1000-row truncation, and org isolation through the caller's RLS.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000080a0', 'a80@test.local'),
  ('00000000-0000-0000-0000-0000000080b0', 'b80@test.local');

create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-0000000080a0', '00000000-0000-0000-0000-0000000080b0');
grant select on t_org to authenticated;

create function pg_temp.org_a() returns uuid language sql as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000080a0'
$$;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- 1500 expenses of 10.00 € (net 8.00) over three months, plus one
-- cancelled row that must never count.
insert into transactions (org_id, tx_date, direction, status, gross_amount, net_amount, vat_amount)
select pg_temp.org_a(), date '2026-01-01' + (i % 90), 'expense', 'paid', 10, 8, 2
from generate_series(1, 1500) i;
insert into transactions (org_id, tx_date, direction, status, gross_amount)
values (pg_temp.org_a(), date '2026-01-15', 'expense', 'cancelled', 999);

-- 1500 rows of AI spend at 0.01 cents each = 15 cents.
insert into ai_usage (org_id, feature, model, input_tokens, output_tokens, cost_cents, created_at)
select pg_temp.org_a(), 'assistant', 'claude-opus-5-5', 1, 1, 0.01, now()
from generate_series(1, 1500);

select pg_temp.as_user('00000000-0000-0000-0000-0000000080a0');

select is((select sum(n)::int from ai_aggregate(pg_temp.org_a(), 'month')), 1500,
  'all 1500 rows are counted (no 1000-row cut-off)');
select is((select sum(gross_total) from ai_aggregate(pg_temp.org_a(), 'month')), 15000.00::numeric,
  'gross total is exact, cancelled excluded');
select is((select gross_total from ai_aggregate(pg_temp.org_a(), 'none')), 15000.00::numeric,
  'ungrouped total matches');
select is((select net_total from ai_aggregate(pg_temp.org_a(), 'none')), 12000.00::numeric,
  'net total is exact');
select is((select count(*)::int from ai_aggregate(pg_temp.org_a(), 'month')), 3,
  'one row per month');
select is((select gross_total from ai_aggregate(pg_temp.org_a(), 'none', p_status => 'cancelled')), 999.00::numeric,
  'an explicit status filter replaces the not-cancelled default');
select throws_ok($$ select * from ai_aggregate(pg_temp.org_a(), 'drop table') $$, '22023', null,
  'unknown group_by is rejected');
select is(
  (select n::int from ai_data_quality(pg_temp.org_a()) where check_name = 'uncategorized_transactions'), 1500,
  'data quality counts uncategorised transactions without truncation');
select is((ai_budget_check(pg_temp.org_a(), 10000) ->> 'spent_cents')::numeric, 15.00::numeric,
  'budget check sums all 1500 usage rows');
reset role;

-- B is in another org: everything is empty / zero.
select pg_temp.as_user('00000000-0000-0000-0000-0000000080b0');
select is((select count(*)::int from ai_aggregate(pg_temp.org_a(), 'month')), 0,
  'another org sees no groups');
select is(
  (select coalesce(sum(n), 0)::int from ai_data_quality(pg_temp.org_a())), 0,
  'another org sees no data-quality findings');
select is((ai_budget_check(pg_temp.org_a(), 10000) ->> 'spent_cents')::numeric, 0::numeric,
  'another org cannot read the spend');
reset role;

select * from finish();
rollback;
