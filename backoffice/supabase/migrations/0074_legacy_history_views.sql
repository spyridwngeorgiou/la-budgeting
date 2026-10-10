-- 0074: the old capture/import history, read-only, in its old shape -- but
-- read from the ingest tables (0072/0073 backfill), so it outlives
-- transaction_drafts and aade_* when Phase 8 (0077) drops them.
--
-- security_invoker: the caller's RLS on ingest_batches/ingest_rows decides
-- what is visible (other orgs see nothing). Read-only: writes are revoked
-- (the single-table one would otherwise be auto-updatable).

create view v_legacy_transaction_drafts with (security_invoker = true) as
select
  (b.meta->>'draft_id')::uuid as draft_id,
  b.org_id,
  b.source::text as source,
  case b.status when 'committed' then 'approved' when 'staged' then 'pending' else 'discarded' end as status,
  r.document_id,
  r.raw as extracted,
  r.meta->'ai'->'proposal' as proposed,
  array(select jsonb_array_elements_text(coalesce(r.meta->'ai'->'needs_review_reasons', '[]'::jsonb))) as needs_review_reasons,
  r.committed_transaction_id as approved_transaction_id,
  b.created_at,
  b.id as ingest_batch_id,
  r.id as ingest_row_id
from ingest_batches b
join ingest_rows r on r.batch_id = b.id and r.row_no = 1
where b.legacy_ref like 'draft:%';

create view v_legacy_aade_batches with (security_invoker = true) as
select
  (b.meta->>'aade_batch_id')::uuid as aade_batch_id,
  b.org_id,
  b.filename,
  b.meta->>'file_sha256' as file_sha256,
  b.meta->>'period' as period,
  b.meta->>'kind' as kind,
  b.row_count,
  (b.meta->>'new_count')::int as new_count,
  (b.meta->>'dup_count')::int as dup_count,
  case b.status when 'committed' then 'committed' when 'discarded' then 'discarded' else 'draft' end as status,
  b.storage_path,
  b.created_by as uploaded_by,
  b.created_at as uploaded_at,
  b.committed_at,
  b.id as ingest_batch_id
from ingest_batches b
where b.legacy_ref like 'aade:%';

create view v_legacy_aade_staging_rows with (security_invoker = true) as
select
  (r.meta->>'aade_staging_row_id')::uuid as aade_staging_row_id,
  r.org_id,
  (b.meta->>'aade_batch_id')::uuid as aade_batch_id,
  r.row_no,
  r.raw,
  r.tx_date as issue_date,
  r.mydata_mark,
  r.invoice_number,
  r.document_type,
  r.meta->>'issuer_afm' as issuer_afm,
  r.meta->>'receiver_afm' as receiver_afm,
  r.counterparty_afm,
  r.counterparty_name,
  r.net_amount,
  r.amount as gross_amount,
  r.vat_amount,
  r.withholding_amount,
  r.other_taxes,
  r.aade_discrepancy as discrepancy,
  r.direction,
  r.meta->>'aade_dedup_status' as dedup_status,
  case r.decision when 'skip' then 'skip' else 'import' end as decision,
  r.project_id,
  r.category_id,
  r.account_id,
  r.committed_transaction_id,
  r.meta->>'commit_error' as commit_error,
  r.id as ingest_row_id
from ingest_rows r
join ingest_batches b on b.id = r.batch_id
where b.legacy_ref like 'aade:%';

do $$
declare
  v text;
begin
  foreach v in array array['v_legacy_transaction_drafts', 'v_legacy_aade_batches', 'v_legacy_aade_staging_rows'] loop
    execute format('revoke insert, update, delete, truncate on %I from public, anon, authenticated, service_role', v);
    execute format('comment on view %I is %L', v,
      'Read-only history of the pre-Φάση 7 capture/import tables, rebuilt from ingest_* (0072/0073).');
  end loop;
end $$;
