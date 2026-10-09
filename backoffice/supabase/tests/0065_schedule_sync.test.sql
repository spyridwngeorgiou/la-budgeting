-- Schedule rows (0065): sync keeps paid rows, removes the tail, refuses a
-- lease when a rent plan exists, and a viewer cannot sync.
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
  ('00000000-0000-0000-0000-0000000065a1', 'owner65@test.local'),
  ('00000000-0000-0000-0000-0000000065b1', 'viewer65@test.local');
create temp table t_ctx as
  select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000065a1';
grant select on t_ctx to authenticated;
-- the second signup gets an org of its own; also make them a viewer in A
insert into org_members (org_id, user_id, role)
select org_id, '00000000-0000-0000-0000-0000000065b1', 'viewer' from t_ctx;

insert into projects (id, org_id, code, display_name, business_model)
select '00000000-0000-0000-0000-0000000065f1', org_id, 'L1', 'Ξενοδοχείο', 'hotel_lease' from t_ctx;
insert into loans (id, org_id, project_id, label, principal, interest_rate, term_years, state)
select '00000000-0000-0000-0000-0000000065c1', org_id, '00000000-0000-0000-0000-0000000065f1',
       'Δάνειο Α', 100000, 0.04, 10, 'approved' from t_ctx;

select is((select business_line::text from projects where id = '00000000-0000-0000-0000-0000000065f1'),
  'hospitality', 'business_line derived from business_model');

select pg_temp.as_user('00000000-0000-0000-0000-0000000065a1');

select is(
  (select array[upserted, protected, removed] from sync_schedule_rows('loan', '00000000-0000-0000-0000-0000000065c1',
    '[{"seq":1,"due_date":"2026-11-30","amount":1000,"interest":300},
      {"seq":2,"due_date":"2026-12-31","amount":1000,"interest":290},
      {"seq":3,"due_date":"2027-01-31","amount":1000,"interest":280}]')),
  array[3, 0, 0], 'first sync writes three scheduled rows');
select is((select count(*)::int from transactions where loan_id = '00000000-0000-0000-0000-0000000065c1' and status = 'scheduled'),
  3, 'rows are scheduled transactions on the loan');
select is((select interest_amount from transactions where loan_id = '00000000-0000-0000-0000-0000000065c1' and schedule_seq = 2),
  290.00::numeric(14,2), 'interest part stored');

-- First instalment gets paid.
update transactions set status = 'paid', paid_on = '2026-11-30'
where loan_id = '00000000-0000-0000-0000-0000000065c1' and schedule_seq = 1;

select is(
  (select array[upserted, protected, removed] from sync_schedule_rows('loan', '00000000-0000-0000-0000-0000000065c1',
    '[{"seq":1,"due_date":"2026-11-30","amount":1500,"interest":300},
      {"seq":2,"due_date":"2026-12-31","amount":1500,"interest":290}]')),
  array[1, 1, 1], 're-sync: paid row protected, seq 2 updated, seq 3 removed');
select is((select gross_amount from transactions where loan_id = '00000000-0000-0000-0000-0000000065c1' and schedule_seq = 1),
  1000.00::numeric(14,2), 'the paid instalment keeps its amount');
select is((select gross_amount from transactions where loan_id = '00000000-0000-0000-0000-0000000065c1' and schedule_seq = 2),
  1500.00::numeric(14,2), 'the open instalment follows the new schedule');
select ok((select schedule_synced_at is not null from loans where id = '00000000-0000-0000-0000-0000000065c1'),
  'sync stamps schedule_synced_at');

-- A lease on a project that already pays rent through an instalment plan.
reset role;
insert into project_leases (id, org_id, project_id, kind, lease_start_month, term_years)
select '00000000-0000-0000-0000-0000000065d1', org_id, '00000000-0000-0000-0000-0000000065f1',
       'indexed_rent', '2026-01-01', 10 from t_ctx;
insert into installment_plans (org_id, label, direction, project_id, amount_per_installment, first_due_date, installment_count, obligation_kind)
select org_id, 'Ενοίκιο', 'expense', '00000000-0000-0000-0000-0000000065f1', 5000, '2026-01-31', 12, 'rent' from t_ctx;
select pg_temp.as_user('00000000-0000-0000-0000-0000000065a1');

select throws_ok(
  $$ select * from sync_schedule_rows('lease', '00000000-0000-0000-0000-0000000065d1',
       '[{"seq":1,"due_date":"2026-01-31","amount":5000}]') $$,
  'P0001', null, 'lease refused while a rent instalment plan exists');

-- Viewer
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000065b1');
select throws_ok(
  $$ select * from sync_schedule_rows('loan', '00000000-0000-0000-0000-0000000065c1', '[]') $$,
  '42501', null, 'a viewer cannot sync a schedule');
reset role;

-- Deleting the loan drops the projection, keeps the paid history.
select pg_temp.as_user('00000000-0000-0000-0000-0000000065a1');
delete from loans where id = '00000000-0000-0000-0000-0000000065c1';
select is((select count(*)::int from transactions where description like 'Δάνειο Α%'), 1,
  'only the paid instalment survives the loan''s deletion');
select is((select array[status::text, coalesce(loan_id::text, 'null'), coalesce(schedule_seq::text, 'null')]
           from transactions where description like 'Δάνειο Α%'),
  array['paid', 'null', 'null'], 'and it is detached from the deleted loan');
reset role;

select * from finish();
rollback;
