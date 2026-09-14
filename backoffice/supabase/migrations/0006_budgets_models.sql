-- 0006: project budgets and business-plan model inputs

create table project_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  version int not null default 1,
  is_current boolean not null default true,
  contingency_pct numeric(6,4) not null default 0,
  non_deductible_vat numeric(14,2) not null default 0,   -- e.g. Q001: 143,408
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, project_id, version)
);
create trigger project_budgets_set_updated_at before update on project_budgets
  for each row execute function set_updated_at();

-- Only one current budget per project at a time.
create unique index project_budgets_one_current_uq on project_budgets (org_id, project_id)
  where is_current;

create table budget_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  budget_id uuid not null references project_budgets(id) on delete cascade,
  line_code budget_line_code not null,
  label text,
  amount numeric(14,2) not null default 0,
  unique (budget_id, line_code)
);

-- Typed key/value store rather than 40 sparse columns: a hotel project needs
-- ADR/occupancy, a development project needs price-per-unit, and adding a new
-- assumption must not require a migration.
create table project_model_inputs (
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  key text not null,      -- adr, occupancy, sale_price_per_unit, annual_opex,
  value jsonb not null,   -- rent_monthly, lease_years, escalation_pct, opening_month...
  primary key (org_id, project_id, key)
);

create table project_seasonality (
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  month int not null check (month between 1 and 12),
  revenue_pct numeric(6,5) not null,   -- Jan 0.01936 ... Dec 0.03271
  primary key (org_id, project_id, month)
);
