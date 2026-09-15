-- 0021: leases, scenarios, operating cost lines, project notes
--
-- The planning layer the two workbooks carry and the app has never had.
-- Everything here is an INPUT; every total, schedule and KPI derived from it
-- is computed in src/lib/finance/ and never stored, per the schema's standing
-- rule that a value which can change without anyone editing its row is a view.

-- ── Leases ─────────────────────────────────────────────────────────────────
-- Two structurally different arrangements exist already, and they are not
-- variants of one shape:
--   Q003 — a plain indexed rent: base + stamp duty, compounding escalation,
--          two contractual step-ups at lease years 11 and 16
--   Q004 — the company additionally services the landlords' AADE tax debt
--          «αντί ενοικίου»; that schedule is not modelled here because it
--          already exists as real, protected instalment plans
-- Detail tables hang off a composite (id, kind) foreign key plus a CHECK, so
-- attaching indexed-rent terms to a settlement lease is structurally
-- impossible rather than merely discouraged.

create type lease_kind as enum ('indexed_rent', 'settlement_service', 'fixed_rent', 'none');

create table project_leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind lease_kind not null,
  lessor_contact_id uuid references contacts(id),
  lease_start_month date not null,
  term_years int not null check (term_years between 1 and 99),
  first_payment_month date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, project_id),
  unique (id, kind)
);
create trigger project_leases_set_updated_at before update on project_leases
  for each row execute function set_updated_at();

create table lease_indexed_terms (
  lease_id uuid primary key references project_leases(id) on delete cascade,
  kind lease_kind not null default 'indexed_rent' check (kind = 'indexed_rent'),
  base_monthly_amount numeric(14,2) not null check (base_monthly_amount >= 0),
  stamp_duty_pct numeric(7,5) not null default 0,            -- 0.03000
  stamp_duty_surcharge_pct numeric(7,5) not null default 0,  -- 0.20000 ΟΓΑ on the stamp
  escalation_pct numeric(7,5) not null default 0,            -- 0.03500, compounds per lease year
  escalation_first_year int not null default 2 check (escalation_first_year >= 1),
  -- The workbook applies neither to the step-ups. Greek stamp duty is charged
  -- on rent actually paid, so stepups_stampable is very likely wrong at false
  -- (~€10k over the Q003 lease). Defaulted to the workbook so reconciliation
  -- passes; the engine raises a diagnostic recommending review.
  stepups_escalate boolean not null default false,
  stepups_stampable boolean not null default false,
  foreign key (lease_id, kind) references project_leases(id, kind) on delete cascade
);

create table lease_step_ups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  lease_id uuid not null references lease_indexed_terms(lease_id) on delete cascade,
  from_lease_year int not null check (from_lease_year >= 1),
  monthly_amount numeric(14,2) not null check (monthly_amount >= 0),
  unique (lease_id, from_lease_year)
);

-- Which instalment plans a lease services in lieu of (or alongside) rent.
-- The schedule itself stays in installment_plans/transactions, which already
-- own escalation and the protection rules for paid instalments -- duplicating
-- it here would be a second source of truth.
create table lease_serviced_settlements (
  lease_id uuid not null references project_leases(id) on delete cascade,
  installment_plan_id uuid not null references installment_plans(id) on delete cascade,
  primary key (lease_id, installment_plan_id)
);

-- ── Scenarios and operating cost lines ─────────────────────────────────────
-- N scenarios per project, not exactly the two the «4 αστέρια» sheet lays out
-- side by side. Growth, discount rate and the ADR dial live here rather than
-- in the untyped project_model_inputs KV, so the engine reads typed,
-- CHECK-constrained columns.

create table project_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  code text not null,                       -- 'base', '4star_full', '4star_lean'
  name text not null,                       -- Greek display label
  is_base boolean not null default false,
  revenue_plan_id uuid references revenue_plans(id) on delete set null,
  -- Used when there is no room-type grid: Q004's operation is a single
  -- stabilised-year figure, and forcing it through revenue_plans would mean
  -- inventing room types that do not exist.
  flat_annual_revenue numeric(14,2),
  adr_multiplier numeric(8,5) not null default 1 check (adr_multiplier > 0),
  revenue_growth_pct numeric(7,5) not null default 0,
  opex_growth_pct numeric(7,5) not null default 0,
  growth_starts_after_operating_year int not null default 3,
  discount_rate_pct numeric(7,5) not null default 0,
  dscr_covenant_min numeric(7,5) not null default 1.2,
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, project_id, code)
);
create unique index project_scenarios_one_base_uq
  on project_scenarios (org_id, project_id) where is_base;
create trigger project_scenarios_set_updated_at before update on project_scenarios
  for each row execute function set_updated_at();

create type opex_line_kind as enum ('payroll', 'pct_of_revenue', 'fixed_annual');

create table opex_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  scenario_id uuid not null references project_scenarios(id) on delete cascade,
  kind opex_line_kind not null,
  label text not null,
  category_id uuid references categories(id),   -- links a plan line to its actuals treatment
  sort_order int not null default 0,

  -- Applies to every kind, so «maintenance rises to 2,5-3% from year six» is a
  -- modelled fact rather than a cell comment nobody acts on.
  from_operating_year int not null default 1 check (from_operating_year >= 1),
  to_operating_year int check (to_operating_year is null or to_operating_year >= from_operating_year),
  grows_with_opex_growth boolean not null default true,

  -- kind = 'payroll'
  headcount numeric(6,2),                       -- numeric: half-posts and shared roles arrive
  monthly_wage numeric(14,2),
  salaries_per_year numeric(5,2),               -- 14: δώρα + επίδομα αδείας
  employer_contribution_pct numeric(7,5),       -- 0.21790 ΕΦΚΑ
  premium_pct numeric(7,5) default 0,           -- 0.14000 νυχτερινά/αργίες
  months_active int default 12 check (months_active between 1 and 12),

  -- kind = 'pct_of_revenue'
  pct_of_revenue numeric(7,5) check (pct_of_revenue is null or pct_of_revenue between 0 and 1),

  -- kind = 'fixed_annual'
  annual_amount numeric(14,2),

  note text,                                    -- the «ΥΠΟΧΡΕΩΤΙΚΟ — κριτήριο 2.6» justifications
  constraint opex_payroll_shape check (kind <> 'payroll' or (
    headcount is not null and monthly_wage is not null
    and salaries_per_year is not null and months_active is not null)),
  constraint opex_pct_shape check (kind <> 'pct_of_revenue' or pct_of_revenue is not null),
  constraint opex_fixed_shape check (kind <> 'fixed_annual' or annual_amount is not null)
);

-- ── Project status and risk notes ──────────────────────────────────────────
-- The Q004 ΚΑΤΑΣΤΑΣΗ block: four bullets, one of them a €16.100 tax exposure
-- on an uninvoiced €35.000 broker fee. The most valuable thing in that
-- workbook and the only part with no home anywhere in the app.

create type project_note_kind as enum ('status', 'risk', 'action', 'milestone');
create type project_note_severity as enum ('info', 'watch', 'urgent');

create table project_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind project_note_kind not null default 'status',
  severity project_note_severity not null default 'info',
  body text not null,
  -- Entered, not derived: 16.100 is a judgement (35.000 × (24% ΦΠΑ + 22% φόρος))
  -- and those rates change.
  exposure_amount numeric(14,2) check (exposure_amount is null or exposure_amount >= 0),
  due_date date,
  resolved_at timestamptz,
  sort_order int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger project_notes_set_updated_at before update on project_notes
  for each row execute function set_updated_at();

create view v_open_project_notes as
select n.*, p.code, p.display_name
from project_notes n
join projects p on p.id = n.project_id
where n.resolved_at is null;

-- ── RLS, same shape as every other org-scoped table (0012) ─────────────────

do $$
declare
  t text;
  tables text[] := array[
    'project_leases','lease_step_ups',
    'project_scenarios','opex_lines','project_notes'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (has_role(org_id, ''viewer''))', t || '_select', t);
    execute format('create policy %I on %I for insert with check (has_role(org_id, ''editor''))', t || '_insert', t);
    execute format('create policy %I on %I for update using (has_role(org_id, ''editor'')) with check (has_role(org_id, ''editor''))', t || '_update', t);
    execute format('create policy %I on %I for delete using (has_role(org_id, ''editor''))', t || '_delete', t);
  end loop;
end $$;

-- lease_indexed_terms and lease_serviced_settlements carry no org_id of their
-- own; they are reachable only through their parent lease, so they inherit
-- their protection from it.
alter table lease_indexed_terms enable row level security;
create policy lease_indexed_terms_all on lease_indexed_terms for all
  using (exists (select 1 from project_leases l where l.id = lease_id and has_role(l.org_id, 'viewer')))
  with check (exists (select 1 from project_leases l where l.id = lease_id and has_role(l.org_id, 'editor')));

alter table lease_serviced_settlements enable row level security;
create policy lease_serviced_settlements_all on lease_serviced_settlements for all
  using (exists (select 1 from project_leases l where l.id = lease_id and has_role(l.org_id, 'viewer')))
  with check (exists (select 1 from project_leases l where l.id = lease_id and has_role(l.org_id, 'editor')));
