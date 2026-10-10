-- 0065: loan and lease schedules as scheduled transactions; expected income
-- that can be weighted and scenario-owned; brokerage deals.
--
-- Same principle as installment plans (0005): a schedule is one real
-- transactions row per payment, so the forecast, the calendar and the P&L
-- are plain filters over the ledger. The difference is who computes the
-- rows. Amortisation and lease escalation live in src/lib/finance/loan.ts and
-- lease.ts and nowhere else -- re-implementing them here would be a second
-- engine that drifts. The app computes the rows and hands them to
-- sync_schedule_rows(), which only stores them.

-- ── Schedule link columns ──────────────────────────────────────────────────
alter table transactions
  add column loan_id uuid references loans(id) on delete set null,
  add column lease_id uuid references project_leases(id) on delete set null,
  add column schedule_seq int check (schedule_seq >= 1),
  -- The interest part of a loan payment. The P&L reads only this from a
  -- loan row (the rest is principal); null on everything else.
  add column interest_amount numeric(14,2) check (interest_amount >= 0);

alter table transactions add constraint tx_schedule_consistency check (
  num_nonnulls(plan_id, loan_id, lease_id) <= 1
  and (schedule_seq is null or loan_id is not null or lease_id is not null)
  and (interest_amount is null or interest_amount <= gross_amount)
);

create unique index tx_loan_seq_uq on transactions (loan_id, schedule_seq) where loan_id is not null and schedule_seq is not null;
create unique index tx_lease_seq_uq on transactions (lease_id, schedule_seq) where lease_id is not null and schedule_seq is not null;

-- When sync_schedule_rows last wrote this source's rows; v_qc_schedule_stale
-- (0066) compares it with updated_at. Equal within the sync's own
-- transaction, since set_updated_at also uses now().
alter table loans add column schedule_synced_at timestamptz;
alter table project_leases add column schedule_synced_at timestamptz;

comment on column transactions.schedule_seq is
  'Position in a loan/lease schedule (1 = first payment). Written only by sync_schedule_rows().';

-- Deleting a loan or lease removes the projection but never the history:
-- unprotected rows go, protected ones (paid, invoiced, with a document) are
-- detached -- the FK's set null then clears loan_id/lease_id.
create function public.schedule_source_deleted() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'loans' then
    delete from transactions t
    where t.loan_id = old.id
      and not (t.status = 'paid' or t.paid_on is not null or t.mydata_mark is not null or t.source_document_id is not null);
    update transactions set schedule_seq = null where loan_id = old.id;
  else
    delete from transactions t
    where t.lease_id = old.id
      and not (t.status = 'paid' or t.paid_on is not null or t.mydata_mark is not null or t.source_document_id is not null);
    update transactions set schedule_seq = null where lease_id = old.id;
  end if;
  return old;
end;
$$;

create trigger loans_schedule_cleanup before delete on loans
  for each row execute function schedule_source_deleted();
create trigger project_leases_schedule_cleanup before delete on project_leases
  for each row execute function schedule_source_deleted();

-- ── sync_schedule_rows ─────────────────────────────────────────────────────
-- p_kind   'loan' | 'lease'
-- p_rows   [{seq, due_date, amount, interest?, description?}, ...] -- the
--          complete schedule as computed in TS; an empty array clears it.
-- Rules, mirroring regenerate_plan (0005):
--   * a protected row (paid, has paid_on, a ΜΑΡΚ or a document) is never
--     touched -- it is historical fact, not a projection
--   * an unprotected row is upserted by (source, seq); status is left as is,
--     so a row someone cancelled stays cancelled
--   * unprotected rows past the end of the new schedule are deleted
-- A lease is refused when the project already has an active rent instalment
-- plan: the rent would be counted twice.
--
-- security invoker: the caller's RLS decides every write. The explicit role
-- check only turns a viewer's silently-filtered no-op into an error.
create function public.sync_schedule_rows(p_kind text, p_source_id uuid, p_rows jsonb)
returns table (upserted int, protected int, removed int)
language plpgsql security invoker set search_path = public as $$
declare
  v_org uuid;
  v_project uuid;
  v_contact uuid;
  v_label text;
  v_category uuid;
  v_account uuid;
  v_upserted int := 0;
  v_protected int := 0;
  v_removed int := 0;
  v_max_seq int;
  r jsonb;
  v_seq int;
  v_due date;
  v_amount numeric(14,2);
  v_interest numeric(14,2);
begin
  if p_kind = 'loan' then
    select l.org_id, l.project_id, null::uuid, l.label into v_org, v_project, v_contact, v_label
    from loans l where l.id = p_source_id;
  elsif p_kind = 'lease' then
    select l.org_id, l.project_id, l.lessor_contact_id, 'Μίσθωμα ' || p.display_name
      into v_org, v_project, v_contact, v_label
    from project_leases l join projects p on p.id = l.project_id where l.id = p_source_id;
  else
    raise exception 'Άγνωστος τύπος προγράμματος: %', p_kind;
  end if;
  if v_org is null then
    raise exception 'Η πηγή του προγράμματος δεν βρέθηκε.';
  end if;
  if not has_role(v_org, 'editor') then
    raise exception 'Δεν έχετε δικαίωμα για αυτή την ενέργεια.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Μη έγκυρο πρόγραμμα πληρωμών.';
  end if;

  if p_kind = 'lease' and jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 0 and exists (
    select 1 from installment_plans ip
    where ip.project_id = v_project and ip.obligation_kind = 'rent' and ip.status = 'active'
  ) then
    raise exception 'Το έργο έχει ήδη πρόγραμμα δόσεων για το ενοίκιο. Ακυρώστε το πρώτα, ώστε το μίσθωμα να μη μετρηθεί δύο φορές.';
  end if;

  select c.id into v_category from categories c
  where c.org_id = v_org and c.code = case when p_kind = 'loan' then 'ΤΟΚΟΧΡΕΟΛΎΣΙΑ' else 'ΕΝΟΊΚΙΑ_AND_ΜΙΣΘΏΜΑΤΑ' end
  limit 1;
  -- the project's earmarked account, if it has exactly one
  select min(a.id::text)::uuid into v_account from accounts a
  where a.org_id = v_org and a.project_id = v_project and a.is_active
  having count(*) = 1;

  v_max_seq := 0;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_seq := (r->>'seq')::int;
    v_due := (r->>'due_date')::date;
    v_amount := round((r->>'amount')::numeric, 2);
    v_interest := case when r ? 'interest' and r->>'interest' is not null then round((r->>'interest')::numeric, 2) end;
    if v_seq is null or v_seq < 1 or v_due is null or v_amount is null or v_amount < 0 then
      raise exception 'Μη έγκυρη γραμμή προγράμματος: %', r;
    end if;
    v_max_seq := greatest(v_max_seq, v_seq);

    if exists (
      select 1 from transactions t
      where (case when p_kind = 'loan' then t.loan_id else t.lease_id end) = p_source_id
        and t.schedule_seq = v_seq
        and (t.status = 'paid' or t.paid_on is not null or t.mydata_mark is not null or t.source_document_id is not null)
    ) then
      v_protected := v_protected + 1;
      continue;
    end if;

    if p_kind = 'loan' then
      insert into transactions (
        org_id, tx_date, due_date, project_id, category_id, account_id, contact_id,
        direction, scope, status, origin, gross_amount, net_amount, vat_amount,
        has_invoice, description, loan_id, schedule_seq, interest_amount
      ) values (
        v_org, v_due, v_due, v_project, v_category, v_account, v_contact,
        'expense', 'business', 'scheduled', 'manual', v_amount, v_amount, 0,
        false, coalesce(r->>'description', v_label || ' — δόση ' || v_seq), p_source_id, v_seq, v_interest
      )
      on conflict (loan_id, schedule_seq) where loan_id is not null and schedule_seq is not null
      do update set tx_date = excluded.tx_date, due_date = excluded.due_date,
                    gross_amount = excluded.gross_amount, net_amount = excluded.net_amount,
                    interest_amount = excluded.interest_amount, description = excluded.description
      where (transactions.tx_date, transactions.gross_amount, transactions.interest_amount, transactions.description)
            is distinct from (excluded.tx_date, excluded.gross_amount, excluded.interest_amount, excluded.description);
    else
      insert into transactions (
        org_id, tx_date, due_date, project_id, category_id, account_id, contact_id,
        direction, scope, status, origin, gross_amount, net_amount, vat_amount,
        has_invoice, description, lease_id, schedule_seq
      ) values (
        v_org, v_due, v_due, v_project, v_category, v_account, v_contact,
        'expense', 'business', 'scheduled', 'manual', v_amount, v_amount, 0,
        false, coalesce(r->>'description', v_label || ' — ' || to_char(v_due, 'MM/YYYY')), p_source_id, v_seq
      )
      on conflict (lease_id, schedule_seq) where lease_id is not null and schedule_seq is not null
      do update set tx_date = excluded.tx_date, due_date = excluded.due_date,
                    gross_amount = excluded.gross_amount, net_amount = excluded.net_amount,
                    description = excluded.description
      where (transactions.tx_date, transactions.gross_amount, transactions.description)
            is distinct from (excluded.tx_date, excluded.gross_amount, excluded.description);
    end if;
    v_upserted := v_upserted + 1;
  end loop;

  with gone as (
    delete from transactions t
    where (case when p_kind = 'loan' then t.loan_id else t.lease_id end) = p_source_id
      and t.schedule_seq > v_max_seq
      and not (t.status = 'paid' or t.paid_on is not null or t.mydata_mark is not null or t.source_document_id is not null)
    returning 1
  )
  select count(*) into v_removed from gone;

  if p_kind = 'loan' then
    update loans set schedule_synced_at = now() where id = p_source_id;
  else
    update project_leases set schedule_synced_at = now() where id = p_source_id;
  end if;

  return query select v_upserted, v_protected, v_removed;
end;
$$;
revoke execute on function public.sync_schedule_rows(text, uuid, jsonb) from public, anon;
grant execute on function public.sync_schedule_rows(text, uuid, jsonb) to authenticated;

-- A scheduled loan/lease row is a projection with no account yet by design;
-- it is not a data-quality problem until it is due.
create or replace view v_qc_missing_project_or_account with (security_invoker = true) as
select t.id as transaction_id, t.org_id, t.tx_date, t.description,
       coalesce(c.name, t.counterparty_name) as contact_name, t.gross_amount,
       (t.project_id is null) as missing_project, (t.account_id is null) as missing_account
from transactions t
left join contacts c on c.id = t.contact_id
where (t.project_id is null or t.account_id is null) and t.status <> 'cancelled'
  and not ((t.loan_id is not null or t.lease_id is not null) and t.status = 'scheduled'
           and t.tx_date > athens_today());

-- ── Expected income ────────────────────────────────────────────────────────
-- probability: null falls back to certainty (certain = 1, probable = 0,5).
-- scenario_id: rows written by «Στείλε στο ταμείο» from a project scenario;
-- deleting the scenario removes them. direction lets the same mechanism
-- carry a scenario's expected costs (expected_income is the historical name).
alter table expected_income
  add column probability numeric(6,4) check (probability between 0 and 1),
  add column status expected_status not null default 'expected',
  add column scenario_id uuid references project_scenarios(id) on delete cascade,
  add column business_line business_line,
  add column direction tx_direction not null default 'income',
  add column owner_scope owner_scope not null default 'corporate';

create index expected_income_org_open_idx on expected_income (org_id, expected_month) where status = 'expected';

-- ── Brokerage deals ────────────────────────────────────────────────────────
-- A list, not a CRM: what is being sold, for whom, at what price and
-- commission, and how far along. Closing a deal creates a pending receivable
-- (transaction_id) and the deal leaves the forecast's weighted pipeline.
create table brokerage_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  property_label text not null,                       -- «Διαμέρισμα Γλυφάδα 85τμ»
  project_id uuid references projects(id) on delete set null,
  client_contact_id uuid references contacts(id) on delete set null,
  price numeric(14,2) not null check (price >= 0),
  commission_pct numeric(7,5) not null default 0.02 check (commission_pct between 0 and 1),
  commission_amount numeric(14,2) check (commission_amount >= 0),  -- null = price × pct
  stage deal_stage not null default 'lead',
  expected_close_date date,
  closed_on date,
  transaction_id uuid references transactions(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index brokerage_deals_org_stage_idx on brokerage_deals (org_id, stage);
create trigger brokerage_deals_set_updated_at before update on brokerage_deals
  for each row execute function set_updated_at();

alter table brokerage_deals enable row level security;
create policy brokerage_deals_select on brokerage_deals for select using (has_role(org_id, 'viewer'));
create policy brokerage_deals_insert on brokerage_deals for insert with check (has_role(org_id, 'editor'));
create policy brokerage_deals_update on brokerage_deals for update using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy brokerage_deals_delete on brokerage_deals for delete using (has_role(org_id, 'editor'));

-- Forecast weight per open stage. One function so the forecast view and
-- the deals page can never disagree.
create function public.deal_stage_probability(p_stage deal_stage) returns numeric
language sql immutable parallel safe as $$
  select case p_stage when 'lead' then 0.1 when 'offer' then 0.3 when 'preliminary' then 0.7
                      when 'closed' then 1 else 0 end::numeric
$$;
