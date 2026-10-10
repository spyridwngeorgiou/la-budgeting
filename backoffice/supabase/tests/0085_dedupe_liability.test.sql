-- 0085: the duplicate «ΣΥΝΟΛΟ ΠΡΟΣ ΙΔΙΩΤΕΣ» liability is archived then
-- removed only when it equals the sum of the other private liabilities;
-- anything else aborts; archive is closed to API roles.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000085a0', 'a85@test.local'),
  ('00000000-0000-0000-0000-0000000085b0', 'b85@test.local');

create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-0000000085a0', '00000000-0000-0000-0000-0000000085b0');

create function pg_temp.org_a() returns uuid language sql as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000085a0'
$$;
create function pg_temp.org_b() returns uuid language sql as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000085b0'
$$;

-- The migration already ran on this database; with no such rows it was a
-- no-op, so the function finds nothing before the fixtures.
select is(archive.dedupe_liability_total(), 0, 'no «ΣΥΝΟΛΟ» rows: nothing to do');

-- Org A: two private loans, the sheet's total of them, and a bank loan
-- (not part of the private total).
insert into liabilities (id, org_id, lender, kind, principal) values
  ('85000000-0000-0000-0000-00000000a001', pg_temp.org_a(), 'Παπαδόπουλος', 'private', 1000.00),
  ('85000000-0000-0000-0000-00000000a002', pg_temp.org_a(), 'Γεωργίου', 'private', 2500.50),
  ('85000000-0000-0000-0000-00000000a003', pg_temp.org_a(), 'ΣΥΝΟΛΟ ΠΡΟΣ ΙΔΙΩΤΕΣ', 'private', 3500.50),
  ('85000000-0000-0000-0000-00000000a004', pg_temp.org_a(), 'Eurobank', 'bank', 90000.00);
-- Org B: a private loan, no total.
insert into liabilities (id, org_id, lender, kind, principal) values
  ('85000000-0000-0000-0000-00000000b001', pg_temp.org_b(), 'Αλεξίου', 'private', 700.00);

select is(archive.dedupe_liability_total(), 1, 'the matching total is removed');
select is(
  (select count(*)::int from liabilities where org_id = pg_temp.org_a()), 3,
  'org A keeps the two private loans and the bank loan'
);
select ok(
  not exists (select 1 from liabilities where id = '85000000-0000-0000-0000-00000000a003'),
  'the «ΣΥΝΟΛΟ» row is gone'
);
select is(
  (select principal from archive.liabilities where id = '85000000-0000-0000-0000-00000000a003'), 3500.50::numeric(14,2),
  'and archived with its principal'
);
select is(
  (select lender from archive.liabilities where id = '85000000-0000-0000-0000-00000000a003'), 'ΣΥΝΟΛΟ ΠΡΟΣ ΙΔΙΩΤΕΣ',
  'and its lender'
);
select ok(
  (select archive_reason like '0085:%' and archived_at is not null
   from archive.liabilities where id = '85000000-0000-0000-0000-00000000a003'),
  'with when and why'
);
select is(
  (select count(*)::int from liabilities where org_id = pg_temp.org_b()), 1,
  'another org is untouched'
);
select is(archive.dedupe_liability_total(), 0, 'running again is a no-op');

-- A «ΣΥΝΟΛΟ…» that does NOT equal the others is not a duplicate: abort.
insert into liabilities (id, org_id, lender, kind, principal) values
  ('85000000-0000-0000-0000-00000000b002', pg_temp.org_b(), 'ΣΥΝΟΛΟ ΠΡΟΣ ΙΔΙΩΤΕΣ', 'private', 999.00);
select throws_like(
  'select archive.dedupe_liability_total()',
  '%not a duplicate total%',
  'a mismatching total raises instead of deleting'
);
select ok(
  exists (select 1 from liabilities where id = '85000000-0000-0000-0000-00000000b002'),
  'and the row is still there'
);

-- archive is closed to the API roles.
select ok(not has_schema_privilege('anon', 'archive', 'usage'), 'anon: no usage on schema archive');
select ok(not has_schema_privilege('authenticated', 'archive', 'usage'), 'authenticated: no usage on schema archive');
select ok(
  not has_function_privilege('authenticated', 'archive.dedupe_liability_total()', 'execute'),
  'authenticated cannot run the dedupe'
);

select * from finish();
rollback;
