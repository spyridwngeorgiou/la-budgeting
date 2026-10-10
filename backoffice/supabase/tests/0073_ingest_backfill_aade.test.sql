-- AADE backfill (0073) + read-only history views (0074): every AADE import
-- becomes one legacy ingest batch in its own org, committed rows linked to
-- their transactions, re-running is a no-op, a half-committed draft commits
-- only the rest in the inbox (old retry behaviour, R17), a batch committed
-- the old way since is re-synced, legacy batches cannot be undone, and
-- another org sees none of it.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'aade-backfill-a@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'aade-backfill-b@test.local');
create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');
grant select on t_org to authenticated;
create function pg_temp.org_a() returns uuid language sql stable as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000000f1' $$;
create function pg_temp.org_b() returns uuid language sql stable as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000000f2' $$;
create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.batch(p_aade text) returns ingest_batches language sql stable as $$
  select * from ingest_batches where legacy_ref = 'aade:' || p_aade $$;
create function pg_temp.row_of(p_aade text, p_row int) returns ingest_rows language sql stable as $$
  select r.* from ingest_rows r join ingest_batches b on b.id = r.batch_id
  where b.legacy_ref = 'aade:' || p_aade and r.row_no = p_row $$;

insert into projects (id, org_id, code, display_name)
values ('83000000-0000-0000-0000-000000000001', pg_temp.org_a(), 'BKF', 'Έργο backfill');
insert into accounts (id, org_id, name, owner_scope, opening_balance, opening_balance_date)
values ('83000000-0000-0000-0000-000000000002', pg_temp.org_a(), 'Τράπεζα', 'corporate', 0, date '2026-01-01');

-- 1: committed the old way. 2: half-committed draft (row 3 failed, row 4 a
-- credit note). 3: another org's draft.
insert into aade_import_batches (id, org_id, filename, file_sha256, period, kind, row_count, new_count, dup_count, status, committed_at)
values
  ('81000000-0000-0000-0000-000000000001', pg_temp.org_a(), '2026-03_expenses.xlsx', 'sha-1', '2026-03', 'expenses', 2, 1, 1, 'committed', now()),
  ('81000000-0000-0000-0000-000000000002', pg_temp.org_a(), '2026-04_expenses.xlsx', 'sha-2', '2026-04', 'expenses', 3, 3, 0, 'draft', null),
  ('81000000-0000-0000-0000-000000000003', pg_temp.org_b(), '2026-04_income.xlsx', 'sha-3', '2026-04', 'income', 1, 1, 0, 'draft', null);

insert into aade_staging_rows (id, org_id, batch_id, row_no, raw, issue_date, mydata_mark, invoice_number, issuer_afm,
                               counterparty_afm, counterparty_name, net_amount, gross_amount, vat_amount, withholding_amount,
                               direction, dedup_status, decision, project_id, account_id, commit_error)
values
  ('82000000-0000-0000-0000-000000000001', pg_temp.org_a(), '81000000-0000-0000-0000-000000000001', 2, '{"row": 2}',
   date '2026-03-02', '500000000000001', 'Τ/1', '111111111', '111111111', 'ΠΡΟΜΗΘΕΥΤΗΣ', 100, 124, 24, 0,
   'expense', 'new', 'import', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002', null),
  ('82000000-0000-0000-0000-000000000002', pg_temp.org_a(), '81000000-0000-0000-0000-000000000001', 3, '{"row": 3}',
   date '2026-03-03', '500000000000009', 'Τ/9', '111111111', '111111111', 'ΠΡΟΜΗΘΕΥΤΗΣ', 10, 12.4, 2.4, 0,
   'expense', 'dup_mark', 'skip', null, null, null),
  ('82000000-0000-0000-0000-000000000003', pg_temp.org_a(), '81000000-0000-0000-0000-000000000002', 2, '{"row": 2}',
   date '2026-04-02', '500000000000002', 'Τ/2', '111111111', '111111111', 'ΠΡΟΜΗΘΕΥΤΗΣ', 50, 62, 12, 0,
   'expense', 'new', 'import', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002', null),
  ('82000000-0000-0000-0000-000000000004', pg_temp.org_a(), '81000000-0000-0000-0000-000000000002', 3, '{"row": 3}',
   date '2026-04-03', '500000000000003', 'Τ/3', '222222222', '222222222', 'ΑΛΛΟΣ ΠΡΟΜΗΘΕΥΤΗΣ', 80, 99.2, 19.2, 0,
   'expense', 'new', 'import', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002',
   'Επαφή: προσωρινό σφάλμα'),
  ('82000000-0000-0000-0000-000000000005', pg_temp.org_a(), '81000000-0000-0000-0000-000000000002', 4, '{"row": 4}',
   date '2026-04-04', '500000000000004', 'ΠΤ/1', '111111111', '111111111', 'ΠΡΟΜΗΘΕΥΤΗΣ', -20, -24.8, -4.8, 0,
   'expense', 'new', 'import', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002', null),
  ('82000000-0000-0000-0000-000000000006', pg_temp.org_b(), '81000000-0000-0000-0000-000000000003', 2, '{"row": 2}',
   date '2026-04-05', '500000000000005', 'Π/1', '999999999', '333333333', 'ΠΕΛΑΤΗΣ', 100, 100, 0, 0,
   'income', 'new', 'import', null, null, null);

-- What commitBatch wrote for the rows that went in.
insert into transactions (id, org_id, tx_date, direction, status, origin, gross_amount, net_amount, vat_amount,
                          has_invoice, mydata_mark, counterparty_afm, project_id, account_id, aade_staging_row_id)
values
  ('84000000-0000-0000-0000-000000000001', pg_temp.org_a(), date '2026-03-02', 'expense', 'paid', 'aade', 124, 100, 24,
   true, '500000000000001', '111111111', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002',
   '82000000-0000-0000-0000-000000000001'),
  ('84000000-0000-0000-0000-000000000002', pg_temp.org_a(), date '2026-04-02', 'expense', 'paid', 'aade', 62, 50, 12,
   true, '500000000000002', '111111111', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002',
   '82000000-0000-0000-0000-000000000003');
update aade_staging_rows set committed_transaction_id = '84000000-0000-0000-0000-000000000001'
where id = '82000000-0000-0000-0000-000000000001';
update aade_staging_rows set committed_transaction_id = '84000000-0000-0000-0000-000000000002'
where id = '82000000-0000-0000-0000-000000000003';

-- ---------------------------------------------------------- backfill
select is(ingest_backfill_aade(), '{"batches": 3, "rows": 6, "resynced": 0}'::jsonb, 'every AADE batch and row is copied once');
select is(ingest_backfill_aade(), '{"batches": 0, "rows": 0, "resynced": 0}'::jsonb, 're-running is a no-op');

select is(
  array[(pg_temp.batch('81000000-0000-0000-0000-000000000001')).status::text,
        (pg_temp.batch('81000000-0000-0000-0000-000000000002')).status::text,
        (pg_temp.batch('81000000-0000-0000-0000-000000000003')).status::text],
  array['committed', 'staged', 'staged'], 'committed -> committed, draft -> staged');
select is((pg_temp.batch('81000000-0000-0000-0000-000000000003')).org_id, pg_temp.org_b(), 'each batch stays in its own org');
select is_empty($$
  select id from ingest_batches where legacy_ref like 'aade:%' and (meta->>'legacy' is distinct from 'true' or source <> 'aade')
$$, 'every backfilled batch is an AADE batch marked legacy');

select is(
  (select ingest_row_id from transactions where id = '84000000-0000-0000-0000-000000000001'),
  (pg_temp.row_of('81000000-0000-0000-0000-000000000001', 2)).id, 'a committed row links its transaction (ingest_row_id)');
select is(
  (select r.decision::text || ':' || r.committed_transaction_id || ':' || r.external_key || ':' || r.amount
   from pg_temp.row_of('81000000-0000-0000-0000-000000000001', 2) r),
  'create:84000000-0000-0000-0000-000000000001:500000000000001:124.00', '... and is a committed «create» row keyed by ΜΑΡΚ');
select is(
  (select r.decision::text || ':' || r.dedup_status::text || ':' || (r.meta->>'aade_dedup_status')
   from pg_temp.row_of('81000000-0000-0000-0000-000000000001', 3) r),
  'skip:already_recorded:dup_mark', 'a duplicate stays skipped, the AADE dedup status kept (R4)');
select is(
  (select coalesce(r.amount::text, 'null') || ':' || r.decision::text || ':' || array_to_string(r.parse_errors, '|')
   from pg_temp.row_of('81000000-0000-0000-0000-000000000002', 4) r),
  'null:skip:Αρνητικό ποσό (πιστωτικό στοιχείο) — δεν εισάγεται αυτόματα.', 'a credit note is staged without an amount (R21)');
select is(
  (select r.decision::text || ':' || (r.committed_at is null)::text || ':' || (r.meta->>'commit_error')
   from pg_temp.row_of('81000000-0000-0000-0000-000000000002', 3) r),
  'create:true:Επαφή: προσωρινό σφάλμα', 'the failed row is still to be written, its commit_error kept');

-- ------------------------------------------------ decided the old way
-- Batch 2 is retried in the old importer: row 3 goes in.
insert into transactions (id, org_id, tx_date, direction, status, origin, gross_amount, net_amount, vat_amount,
                          has_invoice, mydata_mark, counterparty_afm, project_id, account_id, aade_staging_row_id)
values ('84000000-0000-0000-0000-000000000003', pg_temp.org_a(), date '2026-04-03', 'expense', 'paid', 'aade', 99.2, 80, 19.2,
        true, '500000000000003', '222222222', '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002',
        '82000000-0000-0000-0000-000000000004');
update aade_staging_rows set committed_transaction_id = '84000000-0000-0000-0000-000000000003', commit_error = null
where id = '82000000-0000-0000-0000-000000000004';
select is(ingest_backfill_aade(), '{"batches": 1, "rows": 3, "resynced": 1}'::jsonb,
  'a staged copy the old importer has moved on since is rebuilt');
select is(
  array[(select ingest_row_id from transactions where id = '84000000-0000-0000-0000-000000000002'),
        (select ingest_row_id from transactions where id = '84000000-0000-0000-0000-000000000003')],
  array[(pg_temp.row_of('81000000-0000-0000-0000-000000000002', 2)).id,
        (pg_temp.row_of('81000000-0000-0000-0000-000000000002', 3)).id],
  '... and its transactions point at the new copy');
-- Undo the retry again so the inbox has something left to commit.
update aade_staging_rows set committed_transaction_id = null, commit_error = 'Επαφή: προσωρινό σφάλμα'
where id = '82000000-0000-0000-0000-000000000004';
delete from transactions where id = '84000000-0000-0000-0000-000000000003';
select is(ingest_backfill_aade(), '{"batches": 1, "rows": 3, "resynced": 1}'::jsonb, 're-synced back');

-- ------------------------------------------------------------ inbox
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok(
  format('select undo_ingest_batch(%L, %s)', (pg_temp.batch('81000000-0000-0000-0000-000000000001')).id,
         (pg_temp.batch('81000000-0000-0000-0000-000000000001')).version),
  'P0001', 'Η παρτίδα μεταφέρθηκε από το παλιό σύστημα και δεν αναιρείται.', 'a legacy AADE batch cannot be undone');
select is(
  commit_ingest_batch((pg_temp.batch('81000000-0000-0000-0000-000000000002')).id,
                      (pg_temp.batch('81000000-0000-0000-0000-000000000002')).version),
  '{"create": 1, "settle": 0, "settle_partial": 0, "settle_many": 0, "link_existing": 0, "skip": 1}'::jsonb,
  'committing the half-committed batch writes only the row still missing (R17 retry)');
select is(
  (select count(*) from transactions where org_id = pg_temp.org_a() and mydata_mark in ('500000000000002', '500000000000003'))::int,
  2, '... the earlier row is not written twice');
select is((select count(*) from contacts where org_id = pg_temp.org_a() and afm = '222222222')::int, 1,
  '... and its contact is found or created (R10)');
select throws_ok(
  format('select undo_ingest_batch(%L, %s)', (pg_temp.batch('81000000-0000-0000-0000-000000000002')).id,
         (pg_temp.batch('81000000-0000-0000-0000-000000000002')).version),
  'P0001', 'Η παρτίδα μεταφέρθηκε από το παλιό σύστημα και δεν αναιρείται.',
  'a legacy batch finished in the inbox cannot be undone either');
select is(
  (select array_agg(status order by filename) from v_legacy_aade_batches),
  array['committed', 'committed'], 'A reads its two imports through the history view');
select is((select count(*) from v_legacy_aade_staging_rows)::int, 5, '... and their five rows');

-- --------------------------------------------------------- other org
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is((select array_agg(aade_batch_id::text) from v_legacy_aade_batches),
  array['81000000-0000-0000-0000-000000000003'], 'B sees only its own import in the history view');
select is((select count(*) from ingest_rows where org_id = pg_temp.org_a())::int, 0, 'B sees no ingest rows of A');
reset role;

select ok(not has_function_privilege('authenticated', 'public.ingest_backfill_aade()', 'execute'),
  'only the service role / migration owner can run the backfill');
select ok(
  not has_table_privilege('authenticated', 'v_legacy_aade_batches', 'update')
  and not has_table_privilege('authenticated', 'v_legacy_aade_staging_rows', 'insert')
  and not has_table_privilege('authenticated', 'v_legacy_transaction_drafts', 'delete'),
  'the history views are read-only');

select * from finish();
rollback;
