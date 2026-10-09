-- Unified ingestion (0050-0055): commit is atomic, undo restores exactly and
-- refuses after a later edit, the history trigger records actor + batch,
-- overlapping statements cannot book a line twice, other orgs see nothing,
-- and v_account_balances agrees with account_balance_as_of.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(33);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'ingest-a@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'ingest-b@test.local');

create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');
grant select on t_org to authenticated;

create function pg_temp.org_a() returns uuid language sql stable as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000000c1'
$$;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into accounts (id, org_id, name, owner_scope, opening_balance, opening_balance_date)
values ('10000000-0000-0000-0000-000000000001', pg_temp.org_a(), 'Τράπεζα', 'corporate', 1000, current_date - 365);

insert into transactions (id, org_id, tx_date, paid_on, direction, status, gross_amount, net_amount, vat_amount, vat_rate,
                          has_invoice, invoice_number, counterparty_name, account_id)
values
  -- p1: open supplier invoice, settled in full by a bank line
  ('20000000-0000-0000-0000-000000000001', pg_temp.org_a(), current_date - 20, null, 'expense', 'pending',
   124, 100, 24, 0.24, true, 'ΤΔΑ/100', 'ΠΡΟΜΗΘΕΥΤΗΣ Α', null),
  -- p2: open invoice, paid in part
  ('20000000-0000-0000-0000-000000000002', pg_temp.org_a(), current_date - 20, null, 'expense', 'pending',
   496, 400, 96, 0.24, true, 'ΤΔΑ/101', 'ΠΡΟΜΗΘΕΥΤΗΣ Β', null),
  -- paid1: already recorded by hand; the bank line only links to it
  ('20000000-0000-0000-0000-000000000003', pg_temp.org_a(), current_date - 20, current_date - 20, 'income', 'paid',
   300, 300, 0, null, false, null, 'ΠΕΛΑΤΗΣ', '10000000-0000-0000-0000-000000000001'),
  -- fut: paid, but post-dated -- not in the current balance yet
  ('20000000-0000-0000-0000-000000000004', pg_temp.org_a(), current_date, current_date + 10, 'expense', 'paid',
   50, 50, 0, null, false, null, null, '10000000-0000-0000-0000-000000000001'),
  -- pend_in: expected income on the account -- projected only
  ('20000000-0000-0000-0000-000000000005', pg_temp.org_a(), current_date, null, 'income', 'pending',
   200, 200, 0, null, false, null, null, '10000000-0000-0000-0000-000000000001');

insert into ingest_batches (id, org_id, source, account_id, filename) values
  ('30000000-0000-0000-0000-000000000001', pg_temp.org_a(), 'bank_file', '10000000-0000-0000-0000-000000000001', 'atomic.csv'),
  ('30000000-0000-0000-0000-000000000002', pg_temp.org_a(), 'bank_file', '10000000-0000-0000-0000-000000000001', 'main.csv'),
  ('30000000-0000-0000-0000-000000000003', pg_temp.org_a(), 'bank_file', '10000000-0000-0000-0000-000000000001', 'touched.csv'),
  ('30000000-0000-0000-0000-000000000004', pg_temp.org_a(), 'bank_file', '10000000-0000-0000-0000-000000000001', 'march.csv'),
  ('30000000-0000-0000-0000-000000000005', pg_temp.org_a(), 'bank_file', '10000000-0000-0000-0000-000000000001', 'march-overlap.csv'),
  ('30000000-0000-0000-0000-000000000006', pg_temp.org_a(), 'bank_file', '10000000-0000-0000-0000-000000000001', 'undecided.csv');

insert into ingest_rows (id, org_id, batch_id, row_no, row_kind, raw, external_key, tx_date, direction, amount,
                         description, decision, decision_targets)
values
  -- batch 1: row 2 points at a transaction that does not exist -> whole commit fails
  ('40000000-0000-0000-0000-000000000011', pg_temp.org_a(), '30000000-0000-0000-0000-000000000001', 1, 'movement', '{}',
   'k1-1', current_date - 19, 'expense', 10, 'ΠΡΟΜΗΘΕΙΑ', 'create', '{}'),
  ('40000000-0000-0000-0000-000000000012', pg_temp.org_a(), '30000000-0000-0000-0000-000000000001', 2, 'movement', '{}',
   'k1-2', current_date - 18, 'expense', 99, 'ΠΛΗΡΩΜΗ', 'settle', '{20000000-0000-0000-0000-0000000000ff}'),
  -- batch 2: one of every decision
  ('40000000-0000-0000-0000-000000000021', pg_temp.org_a(), '30000000-0000-0000-0000-000000000002', 1, 'movement', '{}',
   'k2-1', current_date - 19, 'expense', 10, 'ΠΡΟΜΗΘΕΙΑ ΕΜΒΑΣΜΑΤΟΣ', 'create', '{}'),
  ('40000000-0000-0000-0000-000000000022', pg_temp.org_a(), '30000000-0000-0000-0000-000000000002', 2, 'movement', '{}',
   'k2-2', current_date - 18, 'expense', 124, 'ΠΛΗΡΩΜΗ ΤΔΑ/100', 'settle', '{20000000-0000-0000-0000-000000000001}'),
  ('40000000-0000-0000-0000-000000000023', pg_temp.org_a(), '30000000-0000-0000-0000-000000000002', 3, 'movement', '{}',
   'k2-3', current_date - 17, 'expense', 200, 'ΕΝΑΝΤΙ ΤΔΑ/101', 'settle_partial', '{20000000-0000-0000-0000-000000000002}'),
  ('40000000-0000-0000-0000-000000000024', pg_temp.org_a(), '30000000-0000-0000-0000-000000000002', 4, 'movement', '{}',
   'k2-4', current_date - 20, 'income', 300, 'ΚΑΤΑΘΕΣΗ ΠΕΛΑΤΗ', 'link_existing', '{20000000-0000-0000-0000-000000000003}'),
  ('40000000-0000-0000-0000-000000000025', pg_temp.org_a(), '30000000-0000-0000-0000-000000000002', 5, 'movement', '{}',
   'k2-5', current_date - 20, 'income', 5, 'ΤΟΚΟΙ', 'skip', '{}'),
  -- batch 3: settle p1, then a human edits p1
  ('40000000-0000-0000-0000-000000000031', pg_temp.org_a(), '30000000-0000-0000-0000-000000000003', 1, 'movement', '{}',
   'k3-1', current_date - 18, 'expense', 124, 'ΠΛΗΡΩΜΗ ΤΔΑ/100', 'settle', '{20000000-0000-0000-0000-000000000001}'),
  -- batches 4 + 5: the same bank line in two overlapping statements
  ('40000000-0000-0000-0000-000000000041', pg_temp.org_a(), '30000000-0000-0000-0000-000000000004', 1, 'movement', '{}',
   'dup-key', current_date - 15, 'income', 42, 'ΚΑΤΑΘΕΣΗ', 'create', '{}'),
  ('40000000-0000-0000-0000-000000000051', pg_temp.org_a(), '30000000-0000-0000-0000-000000000005', 1, 'movement', '{}',
   'dup-key', current_date - 15, 'income', 42, 'ΚΑΤΑΘΕΣΗ', 'create', '{}'),
  -- batch 6: nothing decided yet
  ('40000000-0000-0000-0000-000000000061', pg_temp.org_a(), '30000000-0000-0000-0000-000000000006', 1, 'movement', '{}',
   'k6-1', current_date - 15, 'income', 7, 'ΚΑΤΑΘΕΣΗ', 'pending', '{}');

-- Ledger state before any commit, minus the timestamp every update bumps.
create temp table t_before as
  select t.id, to_jsonb(t) - 'updated_at' as j from transactions t where t.org_id = pg_temp.org_a();

-- --------------------------------------------------------- balances (0050)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');

select is_empty($$
  select account_id from v_account_balances
  where current_balance is distinct from account_balance_as_of(account_id, current_date)
$$, 'v_account_balances.current_balance == account_balance_as_of(current_date)');

select is(
  (select array[current_balance, projected_balance] from v_account_balances
   where account_id = '10000000-0000-0000-0000-000000000001'),
  array[1300, 1450]::numeric[],
  'post-dated payment excluded from current, open items included in projected');

select ok(exists (
  select 1 from find_possible_duplicates(
    (select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000000c1'),
    'expense', 124, current_date - 19)
  where id = '20000000-0000-0000-0000-000000000001'
), 'find_possible_duplicates finds the same amount a day apart');

-- ------------------------------------------------------- profiles (0053)
select is((select count(*) from bank_import_profiles where org_id is null)::int, 5,
  'built-in bank presets are readable');

reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$
  insert into bank_import_profiles (org_id, bank_code, name, column_map) values (null, 'x', 'x', '{}')
$$, '42501', null, 'nobody can write a built-in preset');

-- ------------------------------------------------------ atomicity (0055)
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');

select throws_ok($$
  select commit_ingest_batch('30000000-0000-0000-0000-000000000001',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000001'))
$$, 'P0001', null, 'a failing row fails the whole commit');

select is((select count(*) from transactions
           where ingest_row_id in ('40000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000012'))::int,
  0, 'the good row of the failed commit left nothing in the ledger');

select is(
  (select status::text || ':' || (select count(*) from ingest_rows
     where batch_id = b.id and committed_at is not null)
   from ingest_batches b where b.id = '30000000-0000-0000-0000-000000000001'),
  'staged:0', 'failed batch is still staged with no row committed');

select throws_ok($$
  select commit_ingest_batch('30000000-0000-0000-0000-000000000002',
    (select version - 1 from ingest_batches where id = '30000000-0000-0000-0000-000000000002'))
$$, 'P0001', 'Η παρτίδα άλλαξε στο μεταξύ — ανανεώστε τη σελίδα.', 'a stale version is refused');

-- ------------------------------------------------------------ commit
select lives_ok($$
  select commit_ingest_batch('30000000-0000-0000-0000-000000000002',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000002'))
$$, 'commit applies create/settle/settle_partial/link_existing/skip');

select is(
  (select origin::text || ':' || status::text || ':' || gross_amount from transactions
   where ingest_row_id = '40000000-0000-0000-0000-000000000021'),
  'bank_file:paid:10.00', 'create: a paid bank_file transaction for the fee');

select is(
  (select status::text || ':' || (paid_on = current_date - 18) || ':' || account_id::text || ':' || ingest_row_id::text
   from transactions where id = '20000000-0000-0000-0000-000000000001'),
  'paid:true:10000000-0000-0000-0000-000000000001:40000000-0000-0000-0000-000000000022',
  'settle: invoice marked paid on the bank date, from the statement account');

select is(
  (select array[
     (select gross_amount from transactions where id = '20000000-0000-0000-0000-000000000002'),
     (select gross_amount from transactions where parent_transaction_id = '20000000-0000-0000-0000-000000000002')]),
  array[296, 200]::numeric[], 'settle_partial: 200 carved out of 496');

select is(
  (select status::text || ':' || gross_amount || ':' || ingest_row_id::text
   from transactions where id = '20000000-0000-0000-0000-000000000003'),
  'paid:300.00:40000000-0000-0000-0000-000000000024', 'link_existing: linked, money untouched');

select ok(exists (
  select 1 from transaction_history
  where ingest_batch_id = '30000000-0000-0000-0000-000000000002'
    and actor = '00000000-0000-0000-0000-0000000000c1' and source = 'bank_file'
), 'history records the actor, the batch and the source');

select is_empty($$
  select id from transaction_history
  where ingest_batch_id = '30000000-0000-0000-0000-000000000002'
    and (actor is distinct from '00000000-0000-0000-0000-0000000000c1' or source <> 'bank_file')
$$, 'every history row of the commit carries the same actor/source');

-- -------------------------------------------------------------- undo
select is(
  undo_ingest_batch('30000000-0000-0000-0000-000000000002',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000002'))->>'status',
  'undone', 'undo of an untouched batch succeeds');

reset role;
select set_eq(
  $$ select t.id, to_jsonb(t) - 'updated_at' from transactions t where t.org_id = pg_temp.org_a() $$,
  $$ select id, j from t_before $$,
  'undo restores the ledger exactly');

select is((select count(*) from ingest_rows
           where batch_id = '30000000-0000-0000-0000-000000000002' and (committed_at is not null or applied is not null))::int,
  0, 'undo releases every row (and its external_key)');

-- ------------------------------------------- undo after a later edit
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$
  select commit_ingest_batch('30000000-0000-0000-0000-000000000003',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000003'))
$$, 'second batch commits');

update transactions set description = 'διορθώθηκε με το χέρι' where id = '20000000-0000-0000-0000-000000000001';

select is(
  (select source || ':' || coalesce(ingest_batch_id::text, '-') || ':' || actor::text || ':' || array_to_string(changed_fields, ',')
   from transaction_history where transaction_id = '20000000-0000-0000-0000-000000000001' order by id desc limit 1),
  'app:-:00000000-0000-0000-0000-0000000000c1:description', 'a plain edit is recorded as source app, no batch');

select is(
  undo_ingest_batch('30000000-0000-0000-0000-000000000003',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000003'))->>'status',
  'touched', 'undo refuses when a transaction was edited after the commit');

select is((select status::text from transactions where id = '20000000-0000-0000-0000-000000000001'),
  'paid', 'a refused undo changes nothing');

select is(
  undo_ingest_batch('30000000-0000-0000-0000-000000000003',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000003'), true)->>'status',
  'undone', 'a forced undo goes through');

select is(
  (select status::text || ':' || description from transactions where id = '20000000-0000-0000-0000-000000000001'),
  'pending:διορθώθηκε με το χέρι', 'forced undo reverses the import but keeps the later edit');

-- ------------------------------------------------ overlapping statements
select lives_ok($$
  select commit_ingest_batch('30000000-0000-0000-0000-000000000004',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000004'))
$$, 'first statement commits');

select throws_ok($$
  select commit_ingest_batch('30000000-0000-0000-0000-000000000005',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000005'))
$$, 'P0001', null, 'the overlapping statement cannot book the same line again');

reset role;
select throws_ok($$
  update ingest_rows set committed_at = now() where id = '40000000-0000-0000-0000-000000000051'
$$, '23505', null, 'the committed external_key index is the final guard');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$
  select commit_ingest_batch('30000000-0000-0000-0000-000000000006',
    (select version from ingest_batches where id = '30000000-0000-0000-0000-000000000006'))
$$, 'P0001', 'Υπάρχουν 1 γραμμές χωρίς απόφαση.', 'commit refuses undecided rows');

-- ------------------------------------------------------- other org
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select is((select count(*) from ingest_batches)::int, 0, 'B sees no ingest batches of A');
select is((select count(*) from ingest_rows)::int, 0, 'B sees no ingest rows of A');
select is((select count(*) from transaction_history)::int, 0, 'B sees no history of A');
select throws_ok($$
  select commit_ingest_batch('30000000-0000-0000-0000-000000000006', 1)
$$, 'P0001', 'Η παρτίδα εισαγωγής δεν βρέθηκε.', 'B cannot commit A''s batch');
reset role;

select * from finish();
rollback;
