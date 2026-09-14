-- 0008: financing (loans) and wealth (assets, liabilities, expected income)

create table loans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid references projects(id),
  label text not null,                          -- 'Δάνειο Α'
  principal numeric(14,2) not null,             -- 1,000,000
  interest_rate numeric(7,5) not null,          -- 0.0035
  term_years int not null,
  grace_years int not null default 0,
  first_amortisation_month date,
  state liability_state not null default 'in_application',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger loans_set_updated_at before update on loans
  for each row execute function set_updated_at();

create table loan_drawdowns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  loan_id uuid not null references loans(id) on delete cascade,
  scheduled_month date not null,
  amount numeric(14,2) not null,                -- e.g. 2026-11 / 600,000
  actual_date date,
  actual_amount numeric(14,2)
);

-- Private loans, e.g. Αντώνης €340k άτοκο — distinct from bank loans above,
-- which have amortisation schedules; these are simple obligations.
create table liabilities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  lender text not null,
  kind liability_kind not null default 'private',
  contact_id uuid references contacts(id),
  principal numeric(14,2) not null,
  interest_rate numeric(7,5) not null default 0,
  maturity_date date,
  state liability_state not null default 'disbursed',
  owner_scope owner_scope not null default 'personal',
  terms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger liabilities_set_updated_at before update on liabilities
  for each row execute function set_updated_at();

create table assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,                           -- 'Χρυσός', 'Ακίνητο Λεγρενά'
  category text,                                -- metal | crypto | property | vehicle | watch
  estimated_value numeric(14,2) not null,
  ownership_pct numeric(6,4) not null default 1,-- 0.5 for 50% εξ αδιαιρέτου
  owner_scope owner_scope not null default 'personal',
  state asset_state not null default 'held',    -- pending_inheritance excluded from totals
  valuation_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger assets_set_updated_at before update on assets
  for each row execute function set_updated_at();

create table expected_income (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  source text not null,                         -- 'Αντώνης'
  contact_id uuid references contacts(id),
  project_id uuid references projects(id),
  amount numeric(14,2) not null,
  certainty certainty not null default 'probable',
  expected_month date,
  creates_liability boolean not null default false,  -- a loan inflow also raises debt
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger expected_income_set_updated_at before update on expected_income
  for each row execute function set_updated_at();

comment on column assets.state is
  'pending_inheritance mirrors the workbook''s rule that these amounts are '
  'shown but never summed into net worth (v_net_worth filters them out).';
