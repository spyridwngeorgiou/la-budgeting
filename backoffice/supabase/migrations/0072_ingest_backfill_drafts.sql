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

create function public.ingest_backfill_drafts() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  d record;
  t transactions%rowtype;
  v_batch uuid;
  v_row uuid;
  e jsonb;
  p jsonb;
  v_vat numeric;
  v_net numeric;
  v_gross numeric;
  v_wh numeric;
  v_rate numeric;
  v_created int := 0;
  v_resynced int := 0;
begin
  -- History rows written by the transactions link below are labelled so.
  perform set_config('app.ingest_source', 'legacy_backfill', true);

  -- A draft copied while pending and decided the old way since: start over.
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
    e := d.extracted;
    p := d.proposed;

    insert into ingest_batches (org_id, source, status, row_count, meta, legacy_ref, created_at, committed_at)
    values (
      d.org_id, d.source::text::ingest_source,
      case when t.id is not null then 'committed'::ingest_batch_status
           when d.status = 'pending' then 'staged'::ingest_batch_status
           else 'discarded'::ingest_batch_status end,
      1,
      jsonb_build_object('legacy', true, 'draft_id', d.id, 'document_id', d.document_id),
      'draft:' || d.id, d.created_at, t.created_at)
    returning id into v_batch;

    -- What the old review form opened with (ReviewForm.tsx): net = read net
    -- or total, VAT ticked when any was read, total derived.
    v_vat := case when (e->'vat'->>'value') ~ '^-?\d+(\.\d+)?$' then (e->'vat'->>'value')::numeric end;
    v_net := case when (e->'net'->>'value') ~ '^-?\d+(\.\d+)?$' then (e->'net'->>'value')::numeric end;
    v_gross := case when (e->'gross'->>'value') ~ '^-?\d+(\.\d+)?$' then (e->'gross'->>'value')::numeric end;
    v_wh := case when (e->'withholding'->>'value') ~ '^-?\d+(\.\d+)?$' then (e->'withholding'->>'value')::numeric end;
    v_rate := case when (e->>'vat_rate') ~ '^\d+(\.\d+)?$' and (e->>'vat_rate')::numeric between 0 and 1
                   then (e->>'vat_rate')::numeric end;

    insert into ingest_rows (
      org_id, batch_id, row_no, row_kind, raw, extracted, meta, document_id,
      tx_date, due_date, direction, amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice,
      description, counterparty_name, counterparty_afm, invoice_number, mydata_mark, status, paid_on,
      account_id, project_id, category_id, contact_id, scope, decision, parse_errors,
      applied, committed_at, committed_transaction_id, created_at)
    select
      d.org_id, v_batch, 1, 'document'::ingest_row_kind, e,
      jsonb_build_object('afms', '[]'::jsonb, 'ibans', '[]'::jsonb, 'rfs', '[]'::jsonb, 'marks', '[]'::jsonb),
      jsonb_build_object(
        'legacy', true,
        'ai', jsonb_build_object(
          'model', case when d.source::text = 'ai_nl' then 'claude-haiku-4-5' else 'claude-opus-5' end,
          'draft_id', d.id,
          'needs_review_reasons', to_jsonb(coalesce(d.needs_review_reasons, '{}')),
          'proposal', jsonb_build_object(
            'contactId', p->>'contact_id', 'projectId', p->>'project_id', 'categoryId', p->>'category_id',
            'contactMatchStrength', coalesce(p->>'contact_match_strength', 'none'), 'direction', p->>'direction'))),
      d.document_id,
      x.tx_date, x.due_date, x.direction, x.amount, x.net_amount, x.vat_amount, x.vat_rate, x.withholding_amount,
      x.has_invoice, x.description, x.counterparty_name, x.counterparty_afm, x.invoice_number, x.mydata_mark,
      x.status, x.paid_on, x.account_id, x.project_id, x.category_id, x.contact_id, x.scope,
      case when t.id is not null then 'create'::ingest_decision
           when d.status = 'pending' then 'pending'::ingest_decision
           else 'skip'::ingest_decision end,
      '{}'::text[],
      case when t.id is not null then jsonb_build_object('action', 'create', 'transaction_id', t.id, 'legacy', true) end,
      t.created_at, t.id, d.created_at
    from (
      select
        -- approved: the transaction as it was written
        t.tx_date, t.due_date, t.direction, t.gross_amount as amount, t.net_amount, t.vat_amount, t.vat_rate,
        t.withholding_amount, t.has_invoice, t.description, t.counterparty_name, t.counterparty_afm,
        t.invoice_number, t.mydata_mark, t.status, t.paid_on, t.account_id, t.project_id, t.category_id,
        t.contact_id, t.scope
      where t.id is not null
      union all
      select
        -- pending / discarded: the proposal
        coalesce(ingest_safe_date(e->>'issue_date'), d.created_at::date), null::date,
        case when p->>'direction' = 'income' then 'income'::tx_direction else 'expense'::tx_direction end,
        case when coalesce(v_vat, 0) > 0
             then round(coalesce(v_net, v_gross, 0) * (1 + coalesce(v_rate, 0.24)), 2) - coalesce(v_wh, 0)
             else coalesce(v_net, v_gross) end,
        coalesce(v_net, v_gross),
        case when coalesce(v_vat, 0) > 0 then round(coalesce(v_net, v_gross, 0) * coalesce(v_rate, 0.24), 2) else 0 end,
        case when coalesce(v_vat, 0) > 0 then coalesce(v_rate, 0.24) end,
        case when coalesce(v_vat, 0) > 0 then coalesce(v_wh, 0) else 0 end,
        coalesce(v_vat, 0) > 0, null::text,
        e->>'issuer_name', nullif(regexp_replace(coalesce(e->>'issuer_afm', ''), '\D', '', 'g'), ''),
        e->>'invoice_number', nullif(regexp_replace(coalesce(e->>'mydata_mark', ''), '\D', '', 'g'), ''),
        null::tx_status, null::date, null::uuid,
        (select id from projects where id::text = p->>'project_id' and org_id = d.org_id),
        (select id from categories where id::text = p->>'category_id' and org_id = d.org_id),
        (select id from contacts where id::text = p->>'contact_id' and org_id = d.org_id),
        'business'::tx_scope
      where t.id is null
    ) x
    returning id into v_row;

    -- Amounts the checks would reject (a negative read) are left for the
    -- reviewer instead of failing the backfill.
    update ingest_rows set
      amount = null, net_amount = null, vat_amount = null, withholding_amount = null,
      parse_errors = array['Δεν διαβάστηκε θετικό ποσό — συμπληρώστε το.']
    where id = v_row and committed_at is null
      and (amount is null or amount <= 0 or net_amount < 0 or vat_amount < 0 or withholding_amount < 0);

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
