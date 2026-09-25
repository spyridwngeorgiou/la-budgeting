-- 0030: partial payment against a pending commitment.
--
-- The workbook does this by hand in two edits: add a paid row for what was
-- handed over, and reduce the pending row by the same amount (rows 79/87 +
-- 107/108/113 in workbook 144). Doing only one half double-counts the
-- payment in commitments, so this is a single atomic function.
--
-- One-off commitments only: installment-plan rows are owned by
-- regenerate_plan(), which would restore the full amount on its next run.
--
-- The caller (server action) computes the split with money.ts
-- splitProportionally; this function re-validates every identity rather
-- than trusting it, and locks the parent row so two people paying the same
-- commitment at once cannot both succeed against a stale amount.

alter table transactions add column parent_transaction_id uuid references transactions(id) on delete set null;
create index tx_parent_idx on transactions (parent_transaction_id) where parent_transaction_id is not null;

comment on column transactions.parent_transaction_id is
  'For a partial payment: the pending commitment this payment was carved out of.';

create function public.record_partial_payment(
  p_parent uuid,
  p_expected_parent_gross numeric,
  p_paid_on date,
  p_account uuid,
  p_child_net numeric,
  p_child_vat numeric,
  p_child_wh numeric,
  p_child_gross numeric
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v transactions%rowtype;
  v_child uuid;
begin
  select * into v from transactions where id = p_parent for update;
  if not found then
    raise exception 'Η κίνηση δεν βρέθηκε.';
  end if;
  if v.status not in ('pending', 'scheduled') then
    raise exception 'Μερική πληρωμή γίνεται μόνο σε εκκρεμή ή προγραμματισμένη κίνηση.';
  end if;
  if v.plan_id is not null then
    raise exception 'Οι δόσεις προγράμματος δεν δέχονται μερική πληρωμή.';
  end if;
  if v.gross_amount <> p_expected_parent_gross then
    raise exception 'Το ποσό της κίνησης άλλαξε στο μεταξύ — ανανεώστε τη σελίδα.';
  end if;
  if p_child_gross <= 0 or p_child_gross >= v.gross_amount then
    raise exception 'Το ποσό πρέπει να είναι θετικό και μικρότερο από το υπόλοιπο.';
  end if;
  if p_child_net + p_child_vat - p_child_wh <> p_child_gross then
    raise exception 'Καθαρή + ΦΠΑ − Παρακράτηση ≠ Σύνολο στη μερική πληρωμή.';
  end if;
  if v.net_amount - p_child_net < 0 or v.vat_amount - p_child_vat < 0
     or v.withholding_amount - p_child_wh < 0 then
    raise exception 'Η μερική πληρωμή υπερβαίνει ένα από τα επιμέρους ποσά.';
  end if;

  insert into transactions (
    org_id, tx_date, paid_on, contact_id, counterparty_afm, counterparty_name,
    project_id, category_id, account_id, direction, scope, status, origin,
    gross_amount, net_amount, vat_amount, vat_rate, withholding_amount, has_invoice,
    description, parent_transaction_id, created_by
  ) values (
    v.org_id, p_paid_on, p_paid_on, v.contact_id, v.counterparty_afm, v.counterparty_name,
    v.project_id, v.category_id, coalesce(p_account, v.account_id), v.direction, v.scope, 'paid', 'manual',
    p_child_gross, p_child_net, p_child_vat, v.vat_rate, p_child_wh, v.has_invoice,
    coalesce(v.description, '') || ' — μερική καταβολή', p_parent, auth.uid()
  )
  returning id into v_child;

  update transactions set
    gross_amount = gross_amount - p_child_gross,
    net_amount = net_amount - p_child_net,
    vat_amount = vat_amount - p_child_vat,
    withholding_amount = withholding_amount - p_child_wh
  where id = p_parent;

  return v_child;
end
$$;
