-- 0002: tenancy and role-aware RLS helper
-- Everyone is seeded 'owner' today (sees/edits everything), but every policy
-- from here on checks role, so tightening later is an UPDATE, not a migration.

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  own_afm text not null,              -- decides income vs expense on every AADE import
  legal_name text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint own_afm_9_digits check (own_afm ~ '^[0-9]{9}$')
);
create trigger orgs_set_updated_at before update on orgs
  for each row execute function set_updated_at();

create table org_members (
  org_id  uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role    org_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text
);

-- Returns the caller's role rank against a minimum, so policies read as
-- "at least editor" without repeating the enum ordering everywhere.
create function public.has_role(p_org uuid, p_min org_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members m
    where m.org_id = p_org and m.user_id = auth.uid()
      and array_position(array['viewer','editor','admin','owner']::org_role[], m.role)
          >= array_position(array['viewer','editor','admin','owner']::org_role[], p_min)
  );
$$;

create function public.my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid()
$$;

alter table orgs enable row level security;
alter table org_members enable row level security;
alter table profiles enable row level security;

create policy orgs_select on orgs for select
  using (id in (select my_org_ids()));
create policy orgs_update on orgs for update
  using (has_role(id,'admin')) with check (has_role(id,'admin'));

create policy org_members_select on org_members for select
  using (org_id in (select my_org_ids()));
create policy org_members_write on org_members for all
  using (has_role(org_id,'admin')) with check (has_role(org_id,'admin'));

create policy profiles_select on profiles for select
  using (user_id = auth.uid() or user_id in (
    select om.user_id from org_members om where om.org_id in (select my_org_ids())
  ));
create policy profiles_write on profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- New signups auto-provision an org so the app is usable immediately after signup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
begin
  insert into profiles (user_id, email) values (new.id, new.email);

  insert into orgs (name, own_afm)
    values (coalesce(new.raw_user_meta_data->>'org_name', 'Η επιχείρησή μου'), '000000000')
    returning id into v_org_id;

  insert into org_members (org_id, user_id, role) values (v_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
