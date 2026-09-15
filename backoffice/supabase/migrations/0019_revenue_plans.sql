-- 0019: hospitality revenue estimation plans -- a generalised, reusable
-- version of the one-off "Glyfada Hotel Estimation.xlsx" pattern: N room
-- types x N years x 12 months, each cell an occupancy%/ADR pair (the only
-- real inputs), with nights-sold/revenue/rollups computed, never stored --
-- same "if it can change without anyone editing the row, it's a view" rule
-- as the rest of this schema. Phase 1 is revenue-only, matching what the
-- workbook itself covers; cost/opex lines are a deliberate later addition
-- (project_budgets already exists for that shape once needed).

create table revenue_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,  -- optional: may be explored before a project exists
  name text not null,
  start_year int not null,        -- calendar year of "Year 1", so days-in-month is a real calendar, not a guess
  years int not null default 3 check (years between 1 and 10),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger revenue_plans_set_updated_at before update on revenue_plans
  for each row execute function set_updated_at();

create table revenue_plan_room_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  revenue_plan_id uuid not null references revenue_plans(id) on delete cascade,
  name text not null,             -- 'Junior Suites'
  unit_count int not null check (unit_count > 0),
  sort_order int not null default 0
);

create table revenue_plan_assumptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  room_type_id uuid not null references revenue_plan_room_types(id) on delete cascade,
  year_number int not null check (year_number >= 1),
  month_number int not null check (month_number between 1 and 12),
  occupancy_pct numeric(6,4) not null check (occupancy_pct between 0 and 1),
  adr numeric(10,2) not null check (adr >= 0),
  unique (room_type_id, year_number, month_number)
);

alter table revenue_plans enable row level security;
alter table revenue_plan_room_types enable row level security;
alter table revenue_plan_assumptions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['revenue_plans','revenue_plan_room_types','revenue_plan_assumptions'] loop
    execute format('create policy %I on %I for select using (has_role(org_id, ''viewer''))', t || '_select', t);
    execute format('create policy %I on %I for insert with check (has_role(org_id, ''editor''))', t || '_insert', t);
    execute format('create policy %I on %I for update using (has_role(org_id, ''editor'')) with check (has_role(org_id, ''editor''))', t || '_update', t);
    execute format('create policy %I on %I for delete using (has_role(org_id, ''editor''))', t || '_delete', t);
  end loop;
end $$;
