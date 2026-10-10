-- 0072: transaction_drafts (AI photo / text / email captures, 0010/0026)
-- copied into the ingest tables, so the inbox and CaptureAnalytics see the
-- whole history once INGEST_UNIFIED is on.
--
-- One batch per draft (drafts are independent), legacy_ref
-- 'draft:<id>' and meta.legacy = true:
--   approved  -> committed batch, the row linked to the transaction it
--                became (transactions.ingest_row_id, applied.legacy)
--   pending   -> staged batch with a 'pending' row, reviewable in the inbox
--   discarded -> discarded batch with a 'skip' row
-- ai_corrections of the draft get ingest_row_id. Nothing in the ledger
-- changes except that link.
--
-- Idempotent and re-runnable: ingest_backfill_drafts() skips drafts already
-- copied, and replaces a staged copy whose draft has since been decided the
-- old way. Run it once more right after switching INGEST_UNIFIED on (see the
-- cutover checklist); service role / migration owner only.
--
-- Legacy batches cannot be undone: undo would delete or rewrite
-- transactions the old path wrote, without the before-images undo relies on.

create function public.ingest_safe_date(p text) returns date
language plpgsql immutable set search_path = public as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end;
$$;

-- Numbers the model wrote as JSON numbers or numeric strings; anything else null.
create function public.ingest_safe_num(p jsonb) returns numeric
language plpgsql immutable set search_path = public as $$
begin
  if p is null or jsonb_typeof(p) not in ('number', 'string') or (p #>> '{}') !~ '^\s*-?\d+(\.\d+)?\s*$' then
    return null;
  end if;
  return (p #>> '{}')::numeric;
end;
$$;

create function public.ingest_backfill_drafts() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  d record;
  t transactions%rowtype;
  v_batch uuid;
  v_row uuid;
  e jsonb;
  p jsonb;
  v_read_vat numeric;
  v_read_net numeric;
  v_read_gross numeric;
  v_read_wh numeric;
  v_rate numeric;
  v_base numeric;
  v_has_invoice boolean;
  v_tx_date date;
  v_direction tx_direction;
  v_amount numeric;
  v_net numeric;
  v_vat numeric;
  v_wh numeric;
  v_vat_rate numeric;
  v_errors text[];
  v_afm text;
  v_mark text;
  v_project uuid;
  v_category uuid;
  v_contact uuid;
  v_decision ingest_decision;
  v_status ingest_batch_status;
  v_created int := 0;
  v_resynced int := 0;
begin
  -- History rows written by the transactions link below are labelled so.
  perform set_config('app.ingest_source', 'legacy_backfill', true);

  -- A draft copied while pending and decided the old way since: start over.
  -- Corrections are only written at commit, so none should point at a
  -- staged row -- but ai_corrections.ingest_row_id cascades, so unlink first.
  update ai_corrections c set ingest_row_id = null
  from ingest_rows r, ingest_batches b, transaction_drafts dr
  where c.ingest_row_id = r.id and r.batch_id = b.id
    and b.legacy_ref = 'draft:' || dr.id and b.org_id = dr.org_id
    and b.status = 'staged' and dr.status <> 'pending';
  with stale as (
    delete from ingest_batches b
    using transaction_drafts dr
    where b.legacy_ref = 'draft:' || dr.id and b.org_id = dr.org_id
      and b.status = 'staged' and dr.status <> 'pending'
    returning b.id
  )
  select count(*) into v_resynced from stale;

  for d in
    select dr.* from transaction_drafts dr
    where dr.source::text in ('ai_document', 'ai_nl', 'ai_email')
      and not exists (select 1 from ingest_batches b where b.org_id = dr.org_id and b.legacy_ref = 'draft:' || dr.id)
    order by dr.created_at, dr.id
  loop
    t := null;
    if d.status = 'approved' and d.approved_transaction_id is not null then
      select * into t from transactions where id = d.approved_transaction_id and org_id = d.org_id;
    end if;
    e := coalesce(d.extracted, '{}'::jsonb);
    p := coalesce(d.proposed, '{}'::jsonb);
    v_errors := '{}';
    v_afm := nullif(regexp_replace(coalesce(e->>'issuer_afm', ''), '\D', '', 'g'), '');
    v_mark := nullif(regexp_replace(coalesce(e->>'mydata_mark', ''), '\D', '', 'g'), '');

    if t.id is not null then
      -- approved: the row is the transaction as it was written.
      v_tx_date := t.tx_date;
      v_direction := t.direction;
      v_amount := t.gross_amount;
      v_net := t.net_amount;
      v_vat := t.vat_amount;
      v_wh := t.withholding_amount;
      v_vat_rate := t.vat_rate;
      v_has_invoice := t.has_invoice;
      v_project := t.project_id;
      v_category := t.category_id;
      v_contact := t.contact_id;
      v_decision := 'create';
      v_status := 'committed';
    else
      -- pending / discarded (or approved, but its transaction is gone):
      -- what the old review form opened with, as aiExtractionToStageRow
      -- stages it -- «Με παραστατικό» when any VAT was read, net = the read
      -- net or total, 24% unless read, the total derived.
      v_read_vat := ingest_safe_num(e->'vat'->'value');
      v_read_net := ingest_safe_num(e->'net'->'value');
      v_read_gross := ingest_safe_num(e->'gross'->'value');
      v_read_wh := ingest_safe_num(e->'withholding'->'value');
      v_rate := ingest_safe_num(e->'vat_rate');
      if v_rate is null or v_rate < 0 or v_rate > 1 then
        v_rate := 0.24;
      end if;
      v_has_invoice := coalesce(v_read_vat, 0) > 0;
      v_base := round(coalesce(v_read_net, v_read_gross, 0), 2);
      if v_has_invoice then
        v_net := v_base;
        v_vat := round(v_base * v_rate, 2);
        v_wh := round(coalesce(v_read_wh, 0), 2);
        v_amount := v_net + v_vat - v_wh;
        v_vat_rate := v_rate;
      else
        v_net := v_base;
        v_vat := 0;
        v_wh := 0;
        v_amount := v_base;
        v_vat_rate := null;
      end if;
      -- An amount the checks would reject (a negative or missing read) is
      -- left for the reviewer instead of failing the backfill.
      if v_amount <= 0 or v_net < 0 or v_vat < 0 or v_wh < 0 then
        v_amount := null;
        v_net := null;
        v_vat := null;
        v_wh := null;
        v_errors := array['Δεν διαβάστηκε θετικό ποσό — συμπληρώστε το.'];
      end if;
      v_tx_date := coalesce(ingest_safe_date(e->>'issue_date'), (d.created_at at time zone 'Europe/Athens')::date);
      v_direction := case when p->>'direction' = 'income' then 'income'::tx_direction else 'expense'::tx_direction end;
      -- Ids the proposal named, only while they still exist in this org.
      select x.id into v_project from projects x where x.id::text = p->>'project_id' and x.org_id = d.org_id;
      select x.id into v_category from categories x where x.id::text = p->>'category_id' and x.org_id = d.org_id;
      select x.id into v_contact from contacts x where x.id::text = p->>'contact_id' and x.org_id = d.org_id;
      if d.status = 'pending' then
        v_decision := 'pending';
        v_status := 'staged';
      else
        v_decision := 'skip';
        v_status := 'discarded';
      end if;
    end if;

    insert into ingest_batches (org_id, source, status, row_count, meta, legacy_ref, created_at, committed_at)
    values (
      d.org_id, d.source::text::ingest_source, v_status, 1,
      jsonb_build_object('legacy', true, 'draft_id', d.id, 'draft_status', d.status, 'document_id', d.document_id),
      'draft:' || d.id, d.created_at, t.created_at)
    returning id into v_batch;

    insert into ingest_rows (
      org_id, batch_id, row_no, row_kind, raw, extracted, meta, document_id,
      tx_date, due_date, direction, amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice,
      description, counterparty_name, counterparty_afm, invoice_number, mydata_mark, status, paid_on,
      account_id, project_id, category_id, contact_id, scope, decision, parse_errors,
      applied, committed_at, committed_transaction_id, created_at)
    values (
      d.org_id, v_batch, 1, 'document', e,
      jsonb_build_object(
        'afms', coalesce(to_jsonb(array_remove(array[v_afm], null)), '[]'::jsonb),
        'ibans', '[]'::jsonb, 'rfs', '[]'::jsonb,
        'marks', coalesce(to_jsonb(array_remove(array[v_mark], null)), '[]'::jsonb)),
      jsonb_build_object(
        'legacy', true,
        'ai', jsonb_build_object(
          -- AI_DOCUMENT_MODEL / AI_TEXT_MODEL (adapters/aiShared.ts).
          'model', case when d.source::text = 'ai_nl' then 'claude-haiku-4-5' else 'claude-opus-5' end,
          'draft_id', d.id,
          'needs_review_reasons', to_jsonb(coalesce(d.needs_review_reasons, '{}')),
          'proposal', jsonb_build_object(
            'contactId', p->>'contact_id', 'projectId', p->>'project_id', 'categoryId', p->>'category_id',
            'contactMatchStrength', coalesce(p->>'contact_match_strength', 'none'),
            'direction', v_direction::text))),
      d.document_id,
      v_tx_date, t.due_date, v_direction, v_amount, v_net, v_vat, v_vat_rate, v_wh, v_has_invoice,
      t.description,
      case when t.id is not null then t.counterparty_name else e->>'issuer_name' end,
      case when t.id is not null then t.counterparty_afm else v_afm end,
      case when t.id is not null then t.invoice_number else e->>'invoice_number' end,
      case when t.id is not null then t.mydata_mark else v_mark end,
      t.status, t.paid_on, t.account_id, v_project, v_category, v_contact, coalesce(t.scope, 'business'),
      v_decision, v_errors,
      case when t.id is not null then jsonb_build_object('action', 'create', 'transaction_id', t.id, 'legacy', true) end,
      t.created_at, t.id, d.created_at)
    returning id into v_row;

    if t.id is not null then
      update transactions set ingest_row_id = v_row where id = t.id and ingest_row_id is null;
    end if;
    update ai_corrections set ingest_row_id = v_row where draft_id = d.id and ingest_row_id is null;
    v_created := v_created + 1;
  end loop;

  perform set_config('app.ingest_source', '', true);
  return jsonb_build_object('created', v_created, 'resynced', v_resynced);
end;
$$;

revoke execute on function public.ingest_backfill_drafts() from public, anon, authenticated;
grant execute on function public.ingest_backfill_drafts() to service_role;

comment on function public.ingest_backfill_drafts() is
  'Copies transaction_drafts into ingest_batches/ingest_rows (legacy_ref draft:<id>, meta.legacy). '
  'Idempotent; re-run at INGEST_UNIFIED cutover. Service role only.';

-- Same as 0055, plus: a backfilled (meta.legacy) batch is refused.
create or replace function public.undo_ingest_batch(p_batch uuid, p_expected_version int, p_force boolean default false)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  b ingest_batches%rowtype;
  r ingest_rows%rowtype;
  e jsonb;
  c transactions%rowtype;
  v_ids uuid[];
  v_touched uuid[];
  v_watermark bigint;
begin
  select * into b from ingest_batches where id = p_batch for update;
  if not found then
    raise exception 'Η παρτίδα εισαγωγής δεν βρέθηκε.';
  end if;
  if not has_role(b.org_id, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce((b.meta->>'legacy')::boolean, false) then
    raise exception 'Η παρτίδα μεταφέρθηκε από το παλιό σύστημα και δεν αναιρείται.' using hint = 'legacy_batch';
  end if;
  if b.status <> 'committed' then
    raise exception 'Μόνο οριστικοποιημένη παρτίδα αναιρείται (κατάσταση: %).', b.status;
  end if;
  if b.version <> p_expected_version then
    raise exception 'Η παρτίδα άλλαξε στο μεταξύ — ανανεώστε τη σελίδα.' using hint = 'stale_version';
  end if;

  v_watermark := coalesce((b.meta->>'history_watermark')::bigint, 0);

  select array_agg(distinct s.id) into v_ids from (
    select (x.applied->>'transaction_id')::uuid as id
    from ingest_rows x where x.batch_id = p_batch and x.applied ? 'transaction_id'
    union all
    select (tg->>'id')::uuid
    from ingest_rows x cross join lateral jsonb_array_elements(x.applied->'targets') tg
    where x.batch_id = p_batch and x.applied ? 'targets'
    union all
    select (x.applied->'parent'->>'id')::uuid
    from ingest_rows x where x.batch_id = p_batch and x.applied ? 'parent'
  ) s
  where s.id is not null;

  select array_agg(distinct h.transaction_id) into v_touched
  from transaction_history h
  where h.org_id = b.org_id and h.transaction_id = any (coalesce(v_ids, '{}')) and h.id > v_watermark;

  if v_touched is not null and not p_force then
    return jsonb_build_object('status', 'touched', 'transaction_ids', to_jsonb(v_touched));
  end if;

  perform set_config('app.ingest_batch_id', p_batch::text, true);
  perform set_config('app.ingest_source', b.source::text, true);

  for r in
    select * from ingest_rows
    where batch_id = p_batch and applied is not null
    order by row_no desc
    for update
  loop
    if r.applied->>'action' = 'create' then
      delete from transactions where id = (r.applied->>'transaction_id')::uuid;

    elsif r.applied->>'action' in ('settle', 'settle_many', 'link_existing') then
      for e in select * from jsonb_array_elements(r.applied->'targets') loop
        update transactions set
          status = (e->>'status')::tx_status,
          paid_on = (e->>'paid_on')::date,
          account_id = (e->>'account_id')::uuid,
          ingest_row_id = (e->>'ingest_row_id')::uuid,
          bank_reference = e->>'bank_reference'
        where id = (e->>'id')::uuid;
      end loop;

    elsif r.applied->>'action' = 'settle_partial' then
      e := r.applied->'parent';
      select * into c from transactions where id = (r.applied->>'transaction_id')::uuid for update;
      if found then
        -- Give the carved-out slice back to the commitment, then drop it.
        update transactions set
          gross_amount = gross_amount + c.gross_amount,
          net_amount = net_amount + c.net_amount,
          vat_amount = vat_amount + c.vat_amount,
          withholding_amount = withholding_amount + c.withholding_amount
        where id = (e->>'id')::uuid;
        delete from transactions where id = c.id;
      else
        -- The slice was deleted by hand since (force only): restore as recorded.
        update transactions set
          gross_amount = (e->>'gross_amount')::numeric,
          net_amount = (e->>'net_amount')::numeric,
          vat_amount = (e->>'vat_amount')::numeric,
          withholding_amount = (e->>'withholding_amount')::numeric
        where id = (e->>'id')::uuid;
      end if;
    end if;

    update ingest_rows set
      meta = meta || jsonb_build_object('undone', r.applied),
      applied = null,
      committed_at = null,
      committed_transaction_id = null
    where id = r.id;
  end loop;

  update ingest_batches set
    status = 'undone',
    undone_at = now(),
    undone_by = auth.uid(),
    version = version + 1
  where id = p_batch;

  perform set_config('app.ingest_batch_id', '', true);
  perform set_config('app.ingest_source', '', true);
  return jsonb_build_object('status', 'undone', 'transactions', coalesce(cardinality(v_ids), 0),
                            'forced', v_touched is not null);
end;
$$;

select public.ingest_backfill_drafts();
