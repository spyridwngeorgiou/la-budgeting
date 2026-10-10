-- Drafts backfill (0072) + read-only history view (0074): every
-- transaction_draft becomes one legacy ingest batch in its own org, the
-- approved one linked to its transaction and corrections, re-running is a
-- no-op, a draft decided the old way since is re-synced, legacy batches
-- cannot be undone, and another org sees none of it.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'backfill-a@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'backfill-b@test.local');
create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
grant select on t_org to authenticated;
create function pg_temp.org_a() returns uuid language sql stable as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000000e1' $$;
create function pg_temp.org_b() returns uuid language sql stable as $$
  select org_id from t_org where user_id = '00000000-0000-0000-0000-0000000000e2' $$;
create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.batch(p_draft text) returns uuid language sql stable as $$
  select id from ingest_batches where legacy_ref = 'draft:' || p_draft $$;
create function pg_temp.row1(p_draft text) returns ingest_rows language sql stable as $$
  select r.* from ingest_rows r join ingest_batches b on b.id = r.batch_id where b.legacy_ref = 'draft:' || p_draft $$;

insert into transactions (id, org_id, tx_date, direction, status, origin, gross_amount, net_amount, vat_amount, vat_rate,
                          has_invoice, invoice_number, counterparty_name)
values ('73000000-0000-0000-0000-000000000001', pg_temp.org_a(), date '2026-09-01', 'expense', 'pending', 'ai_document',
        124, 100, 24, 0.24, true, 'Α1', 'ΠΡΟΜΗΘΕΥΤΗΣ');

insert into transaction_drafts (id, org_id, source, extracted, proposed, needs_review_reasons, status, approved_transaction_id)
values
  ('74000000-0000-0000-0000-000000000001', pg_temp.org_a(), 'ai_document',
   '{"issuer_name": "ΠΡΟΜΗΘΕΥΤΗΣ", "issue_date": "2026-09-01", "net": {"value": 100, "evidence": "100,00"},
     "vat": {"value": 24, "evidence": "24,00"}, "gross": {"value": 124, "evidence": "124,00"}, "vat_rate": 0.24,
     "withholding": {"value": 0, "evidence": null}}',
   '{}', '{}', 'approved', '73000000-0000-0000-0000-000000000001'),
  ('74000000-0000-0000-0000-000000000002', pg_temp.org_a(), 'ai_nl',
   '{"issuer_name": "ΠΕΛΑΤΗΣ", "issue_date": "2026-09-02", "net": {"value": 100, "evidence": "124 ευρώ"},
     "vat": {"value": 24, "evidence": "124 ευρώ"}, "gross": {"value": 124, "evidence": "124 ευρώ"}, "vat_rate": 0.24,
     "withholding": {"value": 0, "evidence": null}}',
   '{"direction": "income", "project_id": "79000000-0000-0000-0000-0000000000ff"}',
   '{"Δεν βρέθηκε αντίστοιχο έργο -- επιλέξτε."}', 'pending', null),
  ('74000000-0000-0000-0000-000000000003', pg_temp.org_a(), 'ai_email',
   '{"issue_date": "not a date", "net": {"value": 10}, "vat": {"value": 0}, "gross": {"value": 10}, "withholding": {"value": 0}}',
   '{}', '{}', 'discarded', null),
  ('74000000-0000-0000-0000-000000000005', pg_temp.org_a(), 'ai_document',
   '{"issue_date": "2026-09-03", "net": {"value": null}, "vat": {"value": null}, "gross": {"value": -10}, "withholding": {"value": 0}}',
   '{}', '{}', 'pending', null),
  ('74000000-0000-0000-0000-000000000004', pg_temp.org_b(), 'ai_document',
   '{"issue_date": "2026-09-04", "net": {"value": 50}, "vat": {"value": 0}, "gross": {"value": 50}, "withholding": {"value": 0}}',
   '{}', '{}', 'pending', null);

insert into ai_corrections (id, org_id, field, ai_value, human_value, draft_id)
values ('75000000-0000-0000-0000-000000000001', pg_temp.org_a(), 'net_amount', '99', '100',
        '74000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------- backfill
select is(ingest_backfill_drafts(), '{"created": 5, "resynced": 0}'::jsonb, 'every draft is copied once');
select is(ingest_backfill_drafts(), '{"created": 0, "resynced": 0}'::jsonb, 're-running is a no-op');

select is(
  (select b.status::text || ':' || r.decision::text || ':' || r.committed_transaction_id::text
   from ingest_batches b join ingest_rows r on r.batch_id = b.id where b.legacy_ref = 'draft:74000000-0000-0000-0000-000000000001'),
  'committed:create:73000000-0000-0000-0000-000000000001', 'approved draft -> committed row of its transaction');
select is((select ingest_row_id from transactions where id = '73000000-0000-0000-0000-000000000001'),
  (pg_temp.row1('74000000-0000-0000-0000-000000000001')).id, 'the transaction links back to the row');
select is((select ingest_row_id from ai_corrections where id = '75000000-0000-0000-0000-000000000001'),
  (pg_temp.row1('74000000-0000-0000-0000-000000000001')).id, 'its corrections follow (ingest_row_id)');

select is(
  (select b.status::text || ':' || r.decision::text || ':' || r.direction::text || ':' || r.amount || ':' || r.tx_date
          || ':' || coalesce(r.project_id::text, '-')
   from ingest_batches b join ingest_rows r on r.batch_id = b.id where b.legacy_ref = 'draft:74000000-0000-0000-0000-000000000002'),
  'staged:pending:income:124.00:2026-09-02:-', 'pending draft -> staged row awaiting a decision (dangling project dropped)');
select is((pg_temp.row1('74000000-0000-0000-0000-000000000002')).raw->'gross'->>'evidence', '124 ευρώ',
  'what the model read, with its evidence, is kept');
select is(
  (select b.status::text || ':' || r.decision::text from ingest_batches b join ingest_rows r on r.batch_id = b.id
   where b.legacy_ref = 'draft:74000000-0000-0000-0000-000000000003'),
  'discarded:skip', 'discarded draft -> discarded batch, skipped row');
select is(
  (select coalesce(amount::text, 'null') || ':' || cardinality(parse_errors) from pg_temp.row1('74000000-0000-0000-0000-000000000005')),
  'null:1', 'an unusable amount is left for the reviewer, with a reason');
select is_empty($$
  select id from ingest_batches where legacy_ref like 'draft:%' and meta->>'legacy' is distinct from 'true'
$$, 'every backfilled batch is marked legacy');

-- ------------------------------------------------------------ no undo
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok(
  format('select undo_ingest_batch(%L, %s)', pg_temp.batch('74000000-0000-0000-0000-000000000001'),
         (select version from ingest_batches where id = pg_temp.batch('74000000-0000-0000-0000-000000000001'))),
  'P0001', 'Η παρτίδα μεταφέρθηκε από το παλιό σύστημα και δεν αναιρείται.', 'a legacy batch cannot be undone');
select is((select count(*) from transactions where id = '73000000-0000-0000-0000-000000000001')::int, 1,
  'the refused undo left the transaction in place');
select is((select count(*) from v_legacy_transaction_drafts)::int, 4, 'A reads its four drafts through the history view');

-- --------------------------------------------------------- other org
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is((select array_agg(draft_id::text) from v_legacy_transaction_drafts),
  array['74000000-0000-0000-0000-000000000004'], 'B sees only its own draft in the history view');
select is((select count(*) from ingest_rows where org_id = pg_temp.org_a())::int, 0, 'B sees no ingest rows of A');
select throws_ok(
  format('select commit_ingest_batch(%L, 1)', pg_temp.batch('74000000-0000-0000-0000-000000000002')),
  'P0001', 'Η παρτίδα εισαγωγής δεν βρέθηκε.', 'B cannot commit A''s legacy batch');
reset role;

-- ------------------------------------------------- decided the old way
insert into transactions (id, org_id, tx_date, direction, status, origin, gross_amount, net_amount, vat_amount, vat_rate, has_invoice)
values ('73000000-0000-0000-0000-000000000002', pg_temp.org_a(), date '2026-09-02', 'income', 'pending', 'ai_nl',
        124, 100, 24, 0.24, true);
update transaction_drafts set status = 'approved', approved_transaction_id = '73000000-0000-0000-0000-000000000002'
where id = '74000000-0000-0000-0000-000000000002';
select is(ingest_backfill_drafts(), '{"created": 1, "resynced": 1}'::jsonb,
  'a staged copy whose draft was approved the old way is replaced');
select ok(not has_function_privilege('authenticated', 'public.ingest_backfill_drafts()', 'execute'),
  'only the service role / migration owner can run the backfill');

select * from finish();
rollback;
