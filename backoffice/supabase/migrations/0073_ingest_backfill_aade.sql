-- 0073: AADE imports (aade_import_batches / aade_staging_rows, 0009)
-- copied into the ingest tables, so every AADE file -- old or new -- is
-- one inbox batch and the old tables can go in Phase 8 (0077).
--
-- One ingest batch per AADE batch, legacy_ref 'aade:<id>', meta.legacy:
--   committed -> committed;  discarded -> discarded;  draft -> staged
-- Rows follow the adapter mapping (src/lib/ingest/adapters/aadeFile.ts,
-- rules R1-R21 in src/lib/aade/commitRules.ts): external_key = ΜΑΡΚ,
-- decision import -> create / skip -> skip, dedup status mapped with the
-- original kept in meta.aade_dedup_status, commit_error kept in meta.
-- A row that already went into the ledger is a committed ingest row and its
-- transaction gets ingest_row_id (aade_staging_row_id stays until 0077).
--
-- A half-committed draft batch (commit_error rows, R17) becomes a staged
-- batch whose committed rows are already committed: committing it in the
-- inbox writes only the rest, exactly the old retry behaviour.
--
-- Idempotent (skips AADE batches already copied); re-run at cutover with
-- ingest_backfill_aade(). Service role / migration owner only. Legacy
-- batches cannot be undone (0072).

create function public.ingest_backfill_aade() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  ib aade_import_batches%rowtype;
  sr aade_staging_rows%rowtype;
  v_batch uuid;
  v_row uuid;
  v_net numeric;
  v_vat numeric;
  v_wh numeric;
  v_gross numeric;
  v_negative boolean;
  v_errors text[];
  v_tx_created timestamptz;
  v_key text;
  v_batches int := 0;
  v_rows int := 0;
begin
  perform set_config('app.ingest_source', 'legacy_backfill', true);

  for ib in
    select a.* from aade_import_batches a
    where not exists (select 1 from ingest_batches b where b.org_id = a.org_id and b.legacy_ref = 'aade:' || a.id)
    order by a.uploaded_at, a.id
  loop
    insert into ingest_batches (
      org_id, source, status, filename, file_sha256, storage_path, row_count, meta, legacy_ref,
      created_by, created_at, committed_at)
    values (
      ib.org_id, 'aade',
      case ib.status::text when 'committed' then 'committed'::ingest_batch_status
                           when 'discarded' then 'discarded'::ingest_batch_status
                           else 'staged'::ingest_batch_status end,
      ib.filename,
      -- The same file staged natively since would collide on ingest_batches_file_uq.
      case when exists (select 1 from ingest_batches x where x.org_id = ib.org_id and x.file_sha256 = ib.file_sha256
                        and x.status in ('staged', 'committed')) then null else ib.file_sha256 end,
      ib.storage_path, ib.row_count,
      jsonb_build_object('legacy', true, 'aade_batch_id', ib.id, 'period', ib.period, 'kind', ib.kind,
                         'new_count', ib.new_count, 'dup_count', ib.dup_count, 'storage_bucket', 'aade-imports',
                         'file_sha256', ib.file_sha256),
      'aade:' || ib.id, ib.uploaded_by, ib.uploaded_at, ib.committed_at)
    returning id into v_batch;
    v_batches := v_batches + 1;

    for sr in select * from aade_staging_rows where batch_id = ib.id order by row_no loop
      -- R11 amounts; R21 negatives (credit notes) staged without an amount.
      v_net := coalesce(sr.net_amount, 0);
      v_vat := coalesce(sr.vat_amount, 0);
      v_wh := coalesce(sr.withholding_amount, 0);
      v_gross := coalesce(sr.gross_amount, v_net + v_vat - v_wh);
      v_negative := v_net < 0 or v_vat < 0 or v_wh < 0 or v_gross < 0;
      v_errors := coalesce(sr.parse_errors, '{}');
      if v_negative then
        v_errors := array_append(v_errors, 'Αρνητικό ποσό (πιστωτικό στοιχείο) — δεν εισάγεται αυτόματα.'::text);
      end if;
      v_tx_created := null;
      if sr.committed_transaction_id is not null then
        select created_at into v_tx_created from transactions where id = sr.committed_transaction_id;
      end if;
      -- ΜΑΡΚ as the line identity, unless a committed row already holds it.
      v_key := nullif(sr.mydata_mark, '');
      if v_key is not null and sr.committed_transaction_id is not null and exists (
        select 1 from ingest_rows x where x.org_id = sr.org_id and x.external_key = v_key and x.committed_at is not null
      ) then
        v_key := null;
      end if;

      insert into ingest_rows (
        org_id, batch_id, row_no, row_kind, raw, extracted, meta, external_key,
        tx_date, direction, amount, net_amount, vat_amount, withholding_amount, other_taxes, has_invoice,
        counterparty_name, counterparty_afm, invoice_number, mydata_mark, document_type, aade_discrepancy,
        status, account_id, project_id, category_id, scope, dedup_status, decision, parse_errors,
        applied, committed_at, committed_transaction_id)
      values (
        sr.org_id, v_batch, sr.row_no, 'document', sr.raw,
        jsonb_build_object(
          'afms', to_jsonb(array_remove(array[sr.issuer_afm, sr.receiver_afm], null)),
          'ibans', '[]'::jsonb, 'rfs', '[]'::jsonb,
          'marks', to_jsonb(array_remove(array[nullif(sr.mydata_mark, '')], null))),
        jsonb_build_object(
          'legacy', true, 'aade_staging_row_id', sr.id, 'aade_dedup_status', sr.dedup_status,
          'matched_transaction_id', sr.matched_transaction_id, 'issuer_afm', sr.issuer_afm,
          'receiver_afm', sr.receiver_afm, 'kad_code', sr.kad_code, 'kad_description', sr.kad_description,
          'digital_fee', sr.digital_fee, 'fees', sr.fees, 'deductions', sr.deductions,
          'fingerprint', sr.fingerprint, 'commit_error', sr.commit_error),
        v_key,
        sr.issue_date, sr.direction,
        case when not v_negative then v_gross end,
        case when not v_negative then v_net end,
        case when not v_negative then v_vat end,
        case when not v_negative then v_wh end,
        coalesce(sr.other_taxes, 0), v_vat > 0 or v_wh > 0,
        sr.counterparty_name, sr.counterparty_afm, sr.invoice_number, nullif(sr.mydata_mark, ''),
        sr.document_type, sr.discrepancy,
        sr.status, sr.account_id, sr.project_id, sr.category_id, sr.scope,
        case sr.dedup_status::text
          when 'new' then 'new'::ingest_dedup_status
          when 'dup_mark' then 'already_recorded'::ingest_dedup_status
          when 'dup_fingerprint' then 'already_recorded'::ingest_dedup_status
          else 'dup_in_file'::ingest_dedup_status end,
        case when sr.committed_transaction_id is not null then 'create'::ingest_decision
             when sr.decision::text = 'import' and not v_negative and sr.issue_date is not null and sr.direction is not null
               then 'create'::ingest_decision
             else 'skip'::ingest_decision end,
        v_errors,
        case when sr.committed_transaction_id is not null then
          jsonb_build_object('action', 'create', 'transaction_id', sr.committed_transaction_id, 'legacy', true) end,
        case when sr.committed_transaction_id is not null then coalesce(v_tx_created, ib.committed_at, ib.uploaded_at) end,
        sr.committed_transaction_id)
      returning id into v_row;
      v_rows := v_rows + 1;

      update transactions set ingest_row_id = v_row
      where org_id = sr.org_id and ingest_row_id is null
        and (id = sr.committed_transaction_id or aade_staging_row_id = sr.id);
    end loop;
  end loop;

  perform set_config('app.ingest_source', '', true);
  return jsonb_build_object('batches', v_batches, 'rows', v_rows);
end;
$$;

revoke execute on function public.ingest_backfill_aade() from public, anon, authenticated;
grant execute on function public.ingest_backfill_aade() to service_role;

comment on function public.ingest_backfill_aade() is
  'Copies aade_import_batches/aade_staging_rows into ingest_batches/ingest_rows (legacy_ref aade:<id>, '
  'meta.legacy). Idempotent; re-run at INGEST_UNIFIED cutover. Service role only.';

select public.ingest_backfill_aade();
