-- 0055: apply a reviewed ingest batch to the ledger, and take it back.
--
-- commit_ingest_batch is all-or-nothing: one plpgsql call is one
-- transaction, and any failing row raises, so a statement is never half
-- imported. Every row's effect is written to ingest_rows.applied (ids plus
-- the before-image of every field it changed) -- that, not a re-derivation,
-- is what undo_ingest_batch reverses.
--
-- Both run as the caller (security invoker): RLS still decides which rows
-- exist, and the explicit has_role(editor) check turns "viewer, so the
-- updates silently matched 0 rows" into an error instead of a fake success.
--
-- Errors carry a HINT the app can branch on without parsing Greek text:
--   stale_version   someone else changed the batch since it was loaded
--   undecided_rows  rows still on decision 'pending'
--   duplicate_line  the external_key is on an earlier committed batch

create function public.commit_ingest_batch(p_batch uuid, p_expected_version int)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  b ingest_batches%rowtype;
  r ingest_rows%rowtype;
  t transactions%rowtype;
  v_label text;
  v_tx uuid;
  v_paid_on date;
  v_account uuid;
  v_status tx_status;
  v_gross numeric;
  v_net numeric;
  v_vat numeric;
  v_wh numeric;
  v_ratio numeric;
  v_targets jsonb;
  v_found int;
  v_sum numeric;
  v_pending int;
  v_counts jsonb := '{"create": 0, "settle": 0, "settle_partial": 0, "settle_many": 0, "link_existing": 0, "skip": 0}';
begin
  select * into b from ingest_batches where id = p_batch for update;
  if not found then
    raise exception 'Η παρτίδα εισαγωγής δεν βρέθηκε.';
  end if;
  if not has_role(b.org_id, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if b.status not in ('staged', 'undone') then
    raise exception 'Η παρτίδα δεν μπορεί να οριστικοποιηθεί (κατάσταση: %).', b.status;
  end if;
  if b.version <> p_expected_version then
    raise exception 'Η παρτίδα άλλαξε στο μεταξύ — ανανεώστε τη σελίδα.' using hint = 'stale_version';
  end if;

  select count(*) into v_pending from ingest_rows where batch_id = p_batch and decision = 'pending';
  if v_pending > 0 then
    raise exception 'Υπάρχουν % γραμμές χωρίς απόφαση.', v_pending using hint = 'undecided_rows';
  end if;

  -- Read by the transaction_history trigger (0052) for every change below.
  perform set_config('app.ingest_batch_id', p_batch::text, true);
  perform set_config('app.ingest_source', b.source::text, true);

  for r in
    select * from ingest_rows
    where batch_id = p_batch and committed_at is null
    order by row_no
    for update
  loop
    if r.decision = 'skip' then
      v_counts := jsonb_set(v_counts, '{skip}', to_jsonb((v_counts->>'skip')::int + 1));
      continue;
    end if;

    v_label := 'Γραμμή ' || r.row_no || ': ';
    if r.external_key is not null and exists (
      select 1 from ingest_rows x
      where x.org_id = r.org_id and x.external_key = r.external_key and x.committed_at is not null
    ) then
      raise exception '%η κίνηση έχει ήδη καταχωρηθεί από προηγούμενη εισαγωγή.', v_label
        using hint = 'duplicate_line';
    end if;
    if r.tx_date is null or r.direction is null or r.amount is null or r.amount <= 0 then
      raise exception '%λείπει ημερομηνία, κατεύθυνση ή ποσό.', v_label;
    end if;

    v_paid_on := coalesce(r.paid_on, r.value_date, r.tx_date);
    v_account := coalesce(r.account_id, b.account_id);

    if r.decision = 'create' then
      v_status := coalesce(r.status, case when r.row_kind = 'movement' then 'paid'::tx_status else 'pending'::tx_status end);
      v_gross := r.amount;
      v_vat := coalesce(r.vat_amount, 0);
      v_wh := coalesce(r.withholding_amount, 0);
      v_net := coalesce(r.net_amount, v_gross - v_vat + v_wh);
      if v_net + v_vat - v_wh <> v_gross then
        raise exception '%Καθαρή + ΦΠΑ − Παρακράτηση ≠ Σύνολο.', v_label;
      end if;
      if nullif(r.mydata_mark, '') is not null and exists (
        select 1 from transactions x where x.org_id = b.org_id and x.mydata_mark = r.mydata_mark
      ) then
        raise exception '%υπάρχει ήδη κίνηση με αυτό το ΜΑΡΚ.', v_label;
      end if;

      insert into transactions (
        org_id, tx_date, due_date, paid_on, contact_id, counterparty_afm, counterparty_name,
        project_id, category_id, account_id, direction, scope, status, origin,
        gross_amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice,
        invoice_number, mydata_mark, description, bank_reference, ingest_row_id, created_by
      ) values (
        b.org_id, r.tx_date, null, case when v_status = 'paid' then v_paid_on end,
        r.contact_id, nullif(r.counterparty_afm, ''), r.counterparty_name,
        r.project_id, r.category_id, v_account, r.direction, r.scope, v_status, b.source::text::tx_origin,
        v_gross, v_net, v_vat, r.vat_rate, v_wh, (r.row_kind = 'document' or v_vat > 0 or v_wh > 0),
        r.invoice_number, nullif(r.mydata_mark, ''), r.description, r.reference, r.id, auth.uid()
      )
      returning id into v_tx;

      update ingest_rows set
        applied = jsonb_build_object('action', 'create', 'transaction_id', v_tx),
        committed_at = now(),
        committed_transaction_id = v_tx
      where id = r.id;

    elsif r.decision in ('settle', 'settle_many', 'link_existing') then
      v_targets := '[]';
      v_found := 0;
      v_sum := 0;
      for t in
        select * from transactions where id = any (r.decision_targets) order by id for update
      loop
        v_found := v_found + 1;
        v_sum := v_sum + t.gross_amount;
        if t.org_id <> b.org_id then
          raise exception '%η κίνηση-στόχος ανήκει σε άλλον οργανισμό.', v_label;
        end if;
        if t.direction <> r.direction then
          raise exception '%η κίνηση-στόχος έχει αντίθετη κατεύθυνση.', v_label;
        end if;
        if r.decision = 'link_existing' then
          if t.status = 'cancelled' then
            raise exception '%η κίνηση-στόχος είναι ακυρωμένη.', v_label;
          end if;
        elsif t.status not in ('pending', 'scheduled') then
          raise exception '%η κίνηση-στόχος δεν είναι εκκρεμής (ήδη %).', v_label, t.status;
        end if;

        v_targets := v_targets || jsonb_build_array(jsonb_build_object(
          'id', t.id, 'status', t.status, 'paid_on', t.paid_on, 'account_id', t.account_id,
          'ingest_row_id', t.ingest_row_id, 'bank_reference', t.bank_reference));

        if r.decision = 'link_existing' then
          -- Already in the ledger: claim the bank line, change no money.
          update transactions set
            ingest_row_id = r.id,
            bank_reference = coalesce(t.bank_reference, r.reference),
            account_id = coalesce(t.account_id, v_account),
            paid_on = case when t.status = 'paid' then coalesce(t.paid_on, v_paid_on) else t.paid_on end
          where id = t.id;
        else
          update transactions set
            status = 'paid',
            paid_on = v_paid_on,
            account_id = coalesce(v_account, t.account_id),
            ingest_row_id = r.id,
            bank_reference = coalesce(r.reference, t.bank_reference)
          where id = t.id;
        end if;
      end loop;

      if v_found <> cardinality(r.decision_targets) then
        raise exception '%δεν βρέθηκαν όλες οι κινήσεις-στόχοι.', v_label;
      end if;
      if v_sum <> r.amount then
        raise exception '%το ποσό (%) δεν ισούται με το σύνολο των κινήσεων-στόχων (%).', v_label, r.amount, v_sum;
      end if;

      update ingest_rows set
        applied = jsonb_build_object('action', r.decision::text, 'targets', v_targets),
        committed_at = now(),
        committed_transaction_id = r.decision_targets[1]
      where id = r.id;

    elsif r.decision = 'settle_partial' then
      select * into t from transactions where id = r.decision_targets[1] for update;
      if not found then
        raise exception '%δεν βρέθηκε η κίνηση-στόχος.', v_label;
      end if;
      if t.org_id <> b.org_id then
        raise exception '%η κίνηση-στόχος ανήκει σε άλλον οργανισμό.', v_label;
      end if;
      if t.direction <> r.direction then
        raise exception '%η κίνηση-στόχος έχει αντίθετη κατεύθυνση.', v_label;
      end if;

      -- Same split as money.ts splitProportionally: net and withholding
      -- scale with the paid share, the rounding residue lands on VAT (or on
      -- net when there is no VAT). record_partial_payment re-validates it.
      v_ratio := r.amount / nullif(t.gross_amount, 0);
      v_wh := round(t.withholding_amount * v_ratio, 2);
      if t.vat_amount = 0 then
        v_vat := 0;
        v_net := r.amount + v_wh;
      else
        v_net := round(coalesce(t.net_amount, t.gross_amount) * v_ratio, 2);
        v_vat := r.amount - v_net + v_wh;
      end if;

      v_tx := record_partial_payment(
        t.id, t.gross_amount, v_paid_on, coalesce(v_account, t.account_id), v_net, v_vat, v_wh, r.amount);
      update transactions set
        ingest_row_id = r.id,
        bank_reference = r.reference,
        origin = b.source::text::tx_origin
      where id = v_tx;

      update ingest_rows set
        applied = jsonb_build_object(
          'action', 'settle_partial',
          'transaction_id', v_tx,
          'parent', jsonb_build_object(
            'id', t.id, 'gross_amount', t.gross_amount, 'net_amount', t.net_amount,
            'vat_amount', t.vat_amount, 'withholding_amount', t.withholding_amount)),
        committed_at = now(),
        committed_transaction_id = v_tx
      where id = r.id;
    end if;

    v_counts := jsonb_set(v_counts, array[r.decision::text], to_jsonb((v_counts->>r.decision::text)::int + 1));
  end loop;

  -- Everything this commit wrote to transaction_history has an id at or
  -- below this mark; undo treats anything newer on the same rows as a later
  -- human edit.
  update ingest_batches set
    status = 'committed',
    committed_at = now(),
    committed_by = auth.uid(),
    version = version + 1,
    meta = meta || jsonb_build_object(
      'history_watermark', (select coalesce(max(h.id), 0) from transaction_history h where h.org_id = b.org_id))
  where id = p_batch;

  perform set_config('app.ingest_batch_id', '', true);
  perform set_config('app.ingest_source', '', true);
  return v_counts;
end;
$$;

-- Reverse a committed batch. Refuses (returns status 'touched', changes
-- nothing) when any affected transaction was edited after the commit,
-- unless p_force -- then the import's own effects are reversed and later
-- edits to other fields are left as they are.
create function public.undo_ingest_batch(p_batch uuid, p_expected_version int, p_force boolean default false)
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

revoke execute on function public.commit_ingest_batch(uuid, int) from anon;
revoke execute on function public.undo_ingest_batch(uuid, int, boolean) from anon;
