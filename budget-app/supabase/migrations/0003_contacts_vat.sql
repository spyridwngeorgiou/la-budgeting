-- ============================================================================
-- Rework: contacts (external counterparties) + VAT / withholding breakdown on
-- transactions, plus payable/receivable tracking.
-- ============================================================================

create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  kind         text not null default 'vendor'
               check (kind in ('vendor','client','authority','professional','other')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_contacts_household on public.contacts(household_id);

drop trigger if exists set_updated_at on public.contacts;
create trigger set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- Transaction breakdown fields ------------------------------------------------
alter table public.transactions
  add column if not exists contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists net_amount numeric(14,2),
  add column if not exists vat_amount numeric(14,2) not null default 0,
  add column if not exists withholding_amount numeric(14,2) not null default 0,
  add column if not exists vat_status text not null default 'none'
    check (vat_status in ('none','payable','paid','credit'));

create index if not exists idx_transactions_contact on public.transactions(contact_id);

-- Backfill: existing rows -> net_amount equals the recorded amount.
update public.transactions set net_amount = amount where net_amount is null;

-- RLS for contacts ------------------------------------------------------------
alter table public.contacts enable row level security;

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select
  using (household_id in (select public.my_household_ids()));

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts for insert
  with check (household_id in (select public.my_household_ids()));

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update
  using (household_id in (select public.my_household_ids()));

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts for delete
  using (household_id in (select public.my_household_ids()));
