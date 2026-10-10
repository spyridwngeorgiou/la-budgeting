-- 0071: every source on one pipeline (plan Φάση 7).
--
-- AADE exports, AI-read documents, free-text/voice entries and emails stage
-- into ingest_batches/ingest_rows (0054) and commit through
-- commit_ingest_batch, like bank statements already do. This adds the few
-- columns those sources need and teaches commit_ingest_batch the rules the
-- old AADE importer applied (written down, one by one, in
-- src/lib/aade/commitRules.ts R1-R21; supabase/tests/0071_* diffs the two).
--
-- Nothing old is removed here: aade_* and transaction_drafts keep working
-- while INGEST_UNIFIED is off, and are backfilled in 0072/0073.

-- ------------------------------------------------------------ columns

-- The photo/PDF an ai_document / ai_email row was read from (the review
-- screen shows it next to the fields; commit stamps source_document_id).
alter table ingest_rows add column document_id uuid references documents(id) on delete set null;
create index ingest_rows_document_idx on ingest_rows (document_id) where document_id is not null;

-- Transaction fields only some sources carry. null = "derive as before".
alter table ingest_rows add column due_date date;
alter table ingest_rows add column other_taxes numeric(14,2);      -- AADE ΑΛΛΟΙ ΦΟΡΟΙ (R12)
alter table ingest_rows add column document_type text;            -- AADE ΠΕΡΙΓΡΑΦΗ (R15)
alter table ingest_rows add column aade_discrepancy text;         -- AADE Παράλειψη/Απόκλιση (R15)
-- Books vs pure cash. null: a document, or any VAT/withholding, means yes
-- (the 0055 rule). AADE sets it to vat > 0 or withholding > 0 (R13); the AI
-- review sets what the reviewer ticked.
alter table ingest_rows add column has_invoice boolean;

-- The learning-loop table follows the row, whatever channel it came from.
-- draft_id (0022) stays, nullable, for drafts approved the old way.
alter table ai_corrections add column ingest_row_id uuid references ingest_rows(id) on delete cascade;
alter table ai_corrections alter column draft_id drop not null;
create index ai_corrections_ingest_row_idx on ai_corrections (ingest_row_id) where ingest_row_id is not null;

-- Where a backfilled batch came from: 'draft:<transaction_drafts.id>' or
-- 'aade:<aade_import_batches.id>'. Makes 0072/0073 idempotent and lets the
-- old review URLs redirect to the inbox. null for everything staged natively.
alter table ingest_batches add column legacy_ref text;
create unique index ingest_batches_legacy_ref_uq on ingest_batches (org_id, legacy_ref) where legacy_ref is not null;

comment on column ingest_batches.legacy_ref is
  'Backfill origin (draft:<id> | aade:<id>); such batches also carry meta.legacy = true and cannot be undone.';

-- ------------------------------------------------------------ commit

-- Same contract as 0055 (atomic, version-checked, HINT codes), plus:
--   * source 'aade' follows the old importer (commitRules.ts): every
--     importable row needs a project and an account (R8, hint
--     missing_assignment); the contact is found or created from the
--     counterparty ΑΦΜ (R10); amounts are taken as given, zero allowed and
--     no net + ΦΠΑ − παρακράτηση = σύνολο check (R11); paid_on stays as
--     staged, i.e. NULL (R14); ΜΑΡΚ and fingerprint collisions are refused
--     in words (R16).
--   * every source: due_date, other_taxes, document_type, aade_discrepancy,
--     has_invoice and document_id (-> source_document_id) reach the
--     transaction.
create or replace function public.commit_ingest_batch(p_batch uuid, p_expected_version int)
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
  v_contact uuid;
  v_contact_created boolean;
  v_is_aade boolean;
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
  v_is_aade := b.source = 'aade';

  select count(*) into v_pending from ingest_rows where batch_id = p_batch and decision = 'pending';
  if v_pending > 0 then
    raise exception 'Υπάρχουν % γραμμές χωρίς απόφαση.', v_pending using hint = 'undecided_rows';
  end if;

  -- R8: the old importer refused the whole commit, before writing anything.
  if v_is_aade then
    select count(*) into v_pending from ingest_rows
    where batch_id = p_batch and decision = 'create' and committed_at is null
      and (project_id is null or coalesce(account_id, b.account_id) is null);
    if v_pending > 0 then
      raise exception '% γραμμή/ες δεν έχουν έργο ή λογαριασμό. Συμπληρώστε πριν την οριστικοποίηση.', v_pending
        using hint = 'missing_assignment';
    end if;
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
    -- R11: an AADE document may be worth 0 (VAT-only corrections, zero-value
    -- documents); a bank line or a capture never is.
    if r.tx_date is null or r.direction is null or r.amount is null
       or r.amount < 0 or (r.amount = 0 and not v_is_aade) then
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
      if not v_is_aade and v_net + v_vat - v_wh <> v_gross then
        raise exception '%Καθαρή + ΦΠΑ − Παρακράτηση ≠ Σύνολο.', v_label;
      end if;
      if nullif(r.mydata_mark, '') is not null and exists (
        select 1 from transactions x where x.org_id = b.org_id and x.mydata_mark = r.mydata_mark
      ) then
        raise exception '%υπάρχει ήδη κίνηση με αυτό το ΜΑΡΚ.', v_label;
      end if;
      -- R16: tx_fingerprint_uq (0004), in words rather than as a 23505.
      if v_is_aade and exists (
        select 1 from transactions x
        where x.org_id = b.org_id and x.origin = 'aade'
          and x.fingerprint = (r.tx_date - date '1899-12-30')::text || '-' || coalesce(nullif(r.counterparty_afm, ''), '')
                              || '-' || v_gross::text || '-' || coalesce(nullif(r.mydata_mark, ''), '')
      ) then
        raise exception '%υπάρχει ήδη ίδια κίνηση AADE (ίδια ημερομηνία, ΑΦΜ, ποσό και ΜΑΡΚ).', v_label;
      end if;

      -- R10: the old importer's resolveOrCreateContact.
      v_contact := r.contact_id;
      v_contact_created := false;
      if v_contact is null and v_is_aade and nullif(r.counterparty_afm, '') is not null then
        select c.id into v_contact from contacts c where c.org_id = b.org_id and c.afm = r.counterparty_afm;
        if v_contact is null then
          insert into contacts (org_id, name, afm)
          values (b.org_id, coalesce(r.counterparty_name, r.counterparty_afm), r.counterparty_afm)
          returning id into v_contact;
          v_contact_created := true;
        end if;
      end if;

      insert into transactions (
        org_id, tx_date, due_date, paid_on, contact_id, counterparty_afm, counterparty_name,
        project_id, category_id, account_id, direction, scope, status, origin,
        gross_amount, net_amount, vat_amount, vat_rate, withholding_amount, other_taxes, has_invoice,
        invoice_number, mydata_mark, document_type, aade_discrepancy, description, bank_reference,
        source_document_id, ingest_row_id, created_by
      ) values (
        b.org_id, r.tx_date, r.due_date,
        -- R14: AADE leaves the payment date open (allowed for origin aade).
        case when v_status = 'paid' then (case when v_is_aade then r.paid_on else v_paid_on end) end,
        v_contact, nullif(r.counterparty_afm, ''), r.counterparty_name,
        r.project_id, r.category_id, v_account, r.direction, r.scope, v_status, b.source::text::tx_origin,
        v_gross, v_net, v_vat, r.vat_rate, v_wh, coalesce(r.other_taxes, 0),
        coalesce(r.has_invoice, r.row_kind = 'document' or v_vat > 0 or v_wh > 0),
        r.invoice_number, nullif(r.mydata_mark, ''), r.document_type, r.aade_discrepancy, r.description, r.reference,
        r.document_id, r.id, auth.uid()
      )
      returning id into v_tx;

      -- A contact created here is left in place by undo: it is master data
      -- someone may already have edited or used.
      update ingest_rows set
        applied = jsonb_build_object('action', 'create', 'transaction_id', v_tx)
                  || case when v_contact_created then jsonb_build_object('contact_created', v_contact) else '{}'::jsonb end,
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
