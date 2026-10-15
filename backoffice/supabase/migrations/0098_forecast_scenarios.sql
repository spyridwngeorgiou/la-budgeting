-- 0098: saved «τι θα γινόταν αν» scenarios (/reports/scenarios).
--
-- A scenario is a name and its list of changes, in the same text form the
-- page keeps in its URL (?c=…, lib/finance/whatIf.ts: s.…, d.…, a.…, w.…,
-- r.…, m.…, g.…). Nothing in the forecast reads this table: a scenario is
-- re-run in memory on the forecast of the day it is opened, so it never
-- goes stale and never changes a real figure. Shared by the org (owner's
-- call, 15/10/2026): everyone who sees the reports sees them, editors
-- save and delete. New table only: nothing that runs today changes.

create table forecast_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  changes text[] not null default '{}'
    check (cardinality(changes) <= 60 and octet_length(array_to_string(changes, '')) <= 16 * 1024),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index forecast_scenarios_org_idx on forecast_scenarios (org_id, name);

create trigger forecast_scenarios_set_updated_at before update on forecast_scenarios
  for each row execute function set_updated_at();

alter table forecast_scenarios enable row level security;

create policy forecast_scenarios_select on forecast_scenarios for select
  using (has_role(org_id, 'viewer'));
create policy forecast_scenarios_insert on forecast_scenarios for insert
  with check (has_role(org_id, 'editor'));
create policy forecast_scenarios_update on forecast_scenarios for update
  using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy forecast_scenarios_delete on forecast_scenarios for delete
  using (has_role(org_id, 'editor'));
