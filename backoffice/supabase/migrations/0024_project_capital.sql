-- 0024: capital structure per project.
--
-- project_budgets/budget_lines describe USES of funds (acquisition, studies,
-- construction...) but never SOURCES -- there was no way to answer "how was
-- this actually funded, and by whom". loans already covers bank debt in
-- detail (amortisation, DSCR); this covers the rest -- equity and
-- co-investor money -- and gives every source a dated contribution so a real
-- IRR can be computed against the project's actual cash flow, not just a
-- single lump sum.
create type capital_source_kind as enum ('equity', 'debt', 'co_investor');

create table project_capital_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind capital_source_kind not null,
  contributor text,                    -- who: "Σπύρος", "Τράπεζα Πειραιώς", a partner's name
  amount numeric(14,2) not null check (amount > 0),
  contributed_on date not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table project_capital_sources enable row level security;

create policy project_capital_sources_select on project_capital_sources
  for select using (has_role(org_id, 'viewer'));
create policy project_capital_sources_insert on project_capital_sources
  for insert with check (has_role(org_id, 'editor'));
create policy project_capital_sources_update on project_capital_sources
  for update using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy project_capital_sources_delete on project_capital_sources
  for delete using (has_role(org_id, 'editor'));
