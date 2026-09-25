-- 0027: utilities registry per property.
--
-- The workbook's Ρυθμίσεις «ΠΑΡΟΧΕΣ ΑΝΑ ΑΚΙΝΗΤΟ» block keeps, per property,
-- the electricity supply number, water register, internet line and RF payment
-- codes. Bank statements and ΔΕΗ bills quote exactly those numbers, so storing
-- them lets a payment be attributed to its property by matching the number
-- in its description/notes -- instead of by someone remembering that
-- "6 04185949-04 9" is Λαζαράκη 32.
--
-- match_keys holds each identifier reduced to [0-9A-Z] ("6 04185949-04 9" ->
-- "604185949049") so matching is insensitive to the spaces and dashes that
-- every bank formats differently.

create type utility_kind as enum ('electricity', 'water', 'internet', 'phone', 'other');

create table property_utilities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind utility_kind not null,
  provider text,
  supply_number text,
  contract_account text,
  rf_code text,
  meter_number text,
  notes text,
  is_active boolean not null default true,
  match_keys text[] generated always as (
    array_remove(array[
      nullif(regexp_replace(upper(coalesce(supply_number, '')), '[^0-9A-Z]', '', 'g'), ''),
      nullif(regexp_replace(upper(coalesce(contract_account, '')), '[^0-9A-Z]', '', 'g'), ''),
      nullif(regexp_replace(upper(coalesce(rf_code, '')), '[^0-9A-Z]', '', 'g'), '')
    ], null)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index property_utilities_supply_uq on property_utilities (org_id, kind, supply_number)
  where supply_number is not null;
create index property_utilities_project_idx on property_utilities (org_id, project_id);

create trigger property_utilities_set_updated_at before update on property_utilities
  for each row execute function set_updated_at();

alter table property_utilities enable row level security;

create policy property_utilities_select on property_utilities
  for select using (has_role(org_id, 'viewer'));
create policy property_utilities_insert on property_utilities
  for insert with check (has_role(org_id, 'editor'));
create policy property_utilities_update on property_utilities
  for update using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy property_utilities_delete on property_utilities
  for delete using (has_role(org_id, 'editor'));

-- The one matcher every view and the app share: which active utility (if
-- any) does this free text mention? Keys shorter than 8 characters are
-- ignored -- they're too likely to occur inside an unrelated amount or IBAN.
create function public.match_property_utility(p_org uuid, p_text text)
returns table (utility_id uuid, project_id uuid, kind utility_kind)
language sql stable security invoker set search_path = public as $$
  select u.id, u.project_id, u.kind
  from property_utilities u
  cross join lateral unnest(u.match_keys) as k(key)
  where u.org_id = p_org
    and u.is_active
    and length(k.key) >= 8
    and regexp_replace(upper(coalesce(p_text, '')), '[^0-9A-Z]', '', 'g') like '%' || k.key || '%'
  limit 1
$$;
