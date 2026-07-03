-- ============================================================================
-- LA Budgeting — Initial schema (households, projects, accounts, categories,
-- transactions, expected_income, rooms) with Row-Level Security.
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- ============================================================================

-- Extensions -----------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Helper: updated_at trigger -------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Households & membership (multi-tenant isolation)
-- ============================================================================
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'LA Budgeting',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner','editor','viewer')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Helper: households the current user belongs to
create or replace function public.my_household_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select household_id from public.household_members where user_id = auth.uid();
$$;

-- ============================================================================
-- Core tables
-- ============================================================================
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  description  text,
  status       text not null default 'active' check (status in ('active','completed','on_hold')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.accounts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  type         text not null default 'bank' check (type in ('bank','cash','gold','loan','other')),
  balance      numeric(14,2) not null default 0,
  is_incoming  boolean not null default false, -- true = expected/incoming funds, not yet available
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  kind         text not null default 'expense' check (kind in ('expense','income')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  account_id   uuid references public.accounts(id) on delete set null,
  category_id  uuid references public.categories(id) on delete set null,
  type         text not null default 'expense' check (type in ('expense','income')),
  amount       numeric(14,2) not null default 0,
  status       text not null default 'upcoming' check (status in ('paid','upcoming','planned')),
  tx_date      date not null default current_date,
  source       text,          -- funding source / payment method note
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete cascade,
  name         text not null,
  monthly_rate numeric(14,2) not null default 0,
  occupancy_pct numeric(5,2) not null default 100 check (occupancy_pct >= 0 and occupancy_pct <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.expected_income (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  room_id      uuid references public.rooms(id) on delete set null,
  label        text not null,
  amount       numeric(14,2) not null default 0,
  recurrence   text not null default 'monthly' check (recurrence in ('monthly','oneoff')),
  start_date   date not null default current_date,
  end_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- updated_at triggers --------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['households','projects','accounts','categories','transactions','rooms','expected_income']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I;', t);
    execute format('create trigger set_updated_at before update on public.%I
      for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- Indexes --------------------------------------------------------------------
create index if not exists idx_projects_household on public.projects(household_id);
create index if not exists idx_accounts_household on public.accounts(household_id);
create index if not exists idx_categories_household on public.categories(household_id);
create index if not exists idx_transactions_household on public.transactions(household_id);
create index if not exists idx_transactions_project on public.transactions(project_id);
create index if not exists idx_transactions_account on public.transactions(account_id);
create index if not exists idx_rooms_household on public.rooms(household_id);
create index if not exists idx_expected_income_household on public.expected_income(household_id);

-- ============================================================================
-- Auto-provision a household for every new user (owner) + starter categories
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  insert into public.households (name) values ('LA Budgeting') returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, new.id, 'owner');

  insert into public.categories (household_id, name, kind) values
    (hid, 'Υλικά', 'expense'),
    (hid, 'Εργατικά', 'expense'),
    (hid, 'Άδειες / Μελέτες', 'expense'),
    (hid, 'Έπιπλα / Εξοπλισμός', 'expense'),
    (hid, 'Λοιπά έξοδα', 'expense'),
    (hid, 'Ενοίκια', 'income'),
    (hid, 'Διαχείριση', 'income'),
    (hid, 'Λοιπά έσοδα', 'income');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.projects          enable row level security;
alter table public.accounts          enable row level security;
alter table public.categories        enable row level security;
alter table public.transactions      enable row level security;
alter table public.rooms             enable row level security;
alter table public.expected_income   enable row level security;

-- Households: members can read; owners can update
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select using (id in (select public.my_household_ids()));

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update using (id in (select public.my_household_ids()));

-- Membership: a user can see rows of households they belong to
drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members
  for select using (household_id in (select public.my_household_ids()));

-- Generic policy generator for data tables (select/insert/update/delete)
do $$
declare t text;
begin
  foreach t in array array['projects','accounts','categories','transactions','rooms','expected_income']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format('create policy %1$s_select on public.%1$s for select
      using (household_id in (select public.my_household_ids()));', t);

    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format('create policy %1$s_insert on public.%1$s for insert
      with check (household_id in (select public.my_household_ids()));', t);

    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format('create policy %1$s_update on public.%1$s for update
      using (household_id in (select public.my_household_ids()));', t);

    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);
    execute format('create policy %1$s_delete on public.%1$s for delete
      using (household_id in (select public.my_household_ids()));', t);
  end loop;
end $$;
