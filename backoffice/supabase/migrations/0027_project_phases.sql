-- 0027: project phases -- the road of a project (contract, studies, permit,
-- financing, construction, opening) as dated steps, so the project page can
-- show where we are today, what is late, and how much money each step needs.
--
-- Status is stored, not inferred: a phase is 'done' only when someone says so
-- (with done_on). A phase still open after its planned end is shown as late.
-- kind = 'milestone' is a single date (planned_start = planned_end), e.g.
-- «Έγκριση δανείου».

create table project_phases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  sort_order int not null default 0,
  name text not null,
  kind text not null default 'phase' check (kind in ('phase', 'milestone')),
  planned_start date not null,
  planned_end date not null,
  status text not null default 'next' check (status in ('done', 'active', 'next')),
  done_on date,
  is_estimate boolean not null default true,     -- dates not yet confirmed
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_phases_dates check (planned_end >= planned_start)
);

create index project_phases_project_idx on project_phases (project_id, sort_order);

create trigger project_phases_set_updated_at before update on project_phases
  for each row execute function set_updated_at();

create trigger project_phases_log_activity after insert or update or delete on project_phases
  for each row execute function log_activity();

alter table project_phases enable row level security;
create policy project_phases_select on project_phases for select using (has_role(org_id, 'viewer'));
create policy project_phases_insert on project_phases for insert with check (has_role(org_id, 'editor'));
create policy project_phases_update on project_phases for update
  using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy project_phases_delete on project_phases for delete using (has_role(org_id, 'editor'));
