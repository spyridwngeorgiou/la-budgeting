-- 0037: external project partners (architects, engineers, contractors)
--
-- Partners are scoped to individual projects and live in project_members --
-- they are NEVER inserted into org_members. my_org_ids() ignores role and
-- gates the documents/aade-imports storage policies (0015/0017) and every
-- org-wide table, so a partner row in org_members, even as 'viewer', would
-- hand them receipts and the whole ledger. has_role() therefore stays
-- exactly as it is; everything partner-facing goes through the helpers
-- below instead.

create type project_role as enum ('lead', 'contributor', 'guest');
create type partner_discipline as enum (
  'architect',
  'interior_designer',
  'civil_engineer',
  'mechanical_engineer',
  'electrical_engineer',
  'contractor',
  'surveyor',
  'other'
);

-- Partners have no org whose settings could hold this, and internal users
-- benefit from the same fields on the people list.
alter table profiles
  add column company_name text,
  add column phone text,
  add column default_discipline partner_discipline;

-- Copies org_id from the parent project. Invoker rights on purpose: a caller
-- who cannot see the project (RLS) cannot attach anything to it either, and
-- the org can never be supplied -- or spoofed -- by the client. Rows never
-- move between projects: children (board elements, files...) copy
-- project_id at write time and would be left pointing at the old one.
create function public.set_org_from_project() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'project_id is immutable' using errcode = '42501';
  end if;
  select p.org_id into new.org_id from projects p where p.id = new.project_id;
  if not found then
    raise exception 'project % not found', new.project_id using errcode = '42501';
  end if;
  return new;
end;
$$;

create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references orgs(id) on delete cascade,  -- trigger-maintained
  role       project_role not null default 'contributor',
  discipline partner_discipline,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members (user_id);
create index project_members_org_idx on project_members (org_id);
create trigger project_members_set_org before insert or update on project_members
  for each row execute function set_org_from_project();

-- Pending invitations, matched to the new auth user by email inside
-- handle_new_user. full_name/company_name are typed by the inviting admin,
-- so they are trusted enough to seed the partner's profile; nothing is ever
-- read from the signup's own raw_user_meta_data.
create table project_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,      -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  full_name text,
  company_name text,
  role project_role not null default 'contributor',
  discipline partner_discipline,
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint project_invites_email_normalised check (email = lower(btrim(email)) and email like '%@%')
);
create unique index project_invites_pending_uq on project_invites (project_id, email)
  where accepted_at is null and revoked_at is null;
create index project_invites_email_idx on project_invites (email)
  where accepted_at is null and revoked_at is null;
create trigger project_invites_set_org before insert or update on project_invites
  for each row execute function set_org_from_project();

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so policies on collaboration tables can
-- consult projects/project_members without recursing through their RLS;
-- every one has a fixed search_path and is on the pgTAP allowlist.
-- ---------------------------------------------------------------------------

-- "Has at least one org membership" -- i.e. staff, not an external partner.
create function public.is_internal_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where user_id = auth.uid())
$$;

-- Any internal member of the owning org (viewer and up), or any project member.
create function public.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p where p.id = p_project and has_role(p.org_id, 'viewer')
  ) or exists (
    select 1 from project_members pm where pm.project_id = p_project and pm.user_id = auth.uid()
  )
$$;

-- Drawing/uploading/creating boards: internal editors and up, and partners
-- with lead or contributor. Guests may only look and comment.
create function public.can_edit_collab(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p where p.id = p_project and has_role(p.org_id, 'editor')
  ) or exists (
    select 1 from project_members pm
    where pm.project_id = p_project and pm.user_id = auth.uid()
      and pm.role in ('lead', 'contributor')
  )
$$;

-- The one way a partner reads anything from `projects`, whose row also
-- carries contract_value, collateral_value and the like. Whitelisted,
-- non-financial columns only. my_role is null for internal access.
create function public.my_collab_projects() returns table (
  project_id uuid,
  org_id uuid,
  org_name text,
  code text,
  display_name text,
  status project_status,
  phase text,
  my_role project_role,
  discipline partner_discipline
)
language sql stable security definer set search_path = public as $$
  select p.id, p.org_id, o.name, p.code, p.display_name, p.status, p.phase, pm.role, pm.discipline
  from projects p
  join orgs o on o.id = p.org_id
  left join project_members pm on pm.project_id = p.id and pm.user_id = auth.uid()
  where pm.user_id is not null or has_role(p.org_id, 'viewer')
  order by p.sort_order, p.code
$$;

-- Who is on a project: names, company and discipline only -- never emails
-- or phone numbers, which partners of different firms shouldn't harvest
-- from each other. Empty unless the caller can access the project.
create function public.collab_people(p_project uuid) returns table (
  user_id uuid,
  display_name text,
  company_name text,
  discipline partner_discipline,
  project_role project_role,
  is_internal boolean
)
language sql stable security definer set search_path = public as $$
  select pm.user_id, pr.display_name, pr.company_name, pm.discipline, pm.role, false
  from project_members pm
  left join profiles pr on pr.user_id = pm.user_id
  where pm.project_id = p_project and can_access_project(p_project)
  union all
  select om.user_id, pr.display_name, pr.company_name, null, null, true
  from projects p
  join org_members om on om.org_id = p.org_id
  left join profiles pr on pr.user_id = om.user_id
  where p.id = p_project and can_access_project(p_project)
$$;

revoke execute on function public.is_internal_user() from public, anon;
revoke execute on function public.can_access_project(uuid) from public, anon;
revoke execute on function public.can_edit_collab(uuid) from public, anon;
revoke execute on function public.my_collab_projects() from public, anon;
revoke execute on function public.collab_people(uuid) from public, anon;
grant execute on function public.is_internal_user() to authenticated;
grant execute on function public.can_access_project(uuid) to authenticated;
grant execute on function public.can_edit_collab(uuid) to authenticated;
grant execute on function public.my_collab_projects() to authenticated;
grant execute on function public.collab_people(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table project_members enable row level security;
alter table project_invites enable row level security;

-- A partner sees only their own membership rows; the rest of the team comes
-- through collab_people() (names only).
create policy project_members_select on project_members for select
  using (user_id = auth.uid() or has_role(org_id, 'viewer'));
create policy project_members_write on project_members for all
  using (has_role(org_id, 'admin')) with check (has_role(org_id, 'admin'));

-- Invites hold email addresses: admins only, both directions.
create policy project_invites_admin on project_invites for all
  using (has_role(org_id, 'admin')) with check (has_role(org_id, 'admin'));

-- Internal staff need partner names/emails for the project's partner panel.
-- Partners still see only themselves (they have no my_org_ids()).
create policy profiles_select_project_partners on profiles for select
  using (user_id in (
    select pm.user_id from project_members pm where pm.org_id in (select my_org_ids())
  ));

-- ---------------------------------------------------------------------------
-- Signup: a pending invite turns the new user into a project partner and
-- skips the auto-provisioned org entirely.
-- ---------------------------------------------------------------------------
-- The match is on the invite table's email (written by an org admin), never
-- on user metadata the signup itself supplied. It is only honoured when the
-- auth user arrives through a channel that proves the address: an admin
-- invite (invited_at, set by inviteUserByEmail) or an already-confirmed
-- email (admin createUser with email_confirm). A self-service signup that
-- merely *claims* an invited address gets the old behaviour -- its own empty
-- org -- and no access to the project.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_inv record;
  v_accepted int := 0;
begin
  insert into profiles (user_id, email) values (new.id, new.email);

  if new.email is not null and (new.invited_at is not null or new.email_confirmed_at is not null) then
    for v_inv in
      update project_invites i
         set accepted_at = now(), accepted_by = new.id
       where i.email = lower(btrim(new.email))
         and i.accepted_at is null and i.revoked_at is null
         and i.expires_at > now()
      returning i.project_id, i.role, i.discipline, i.invited_by, i.full_name, i.company_name
    loop
      insert into project_members (project_id, user_id, role, discipline, invited_by)
        values (v_inv.project_id, new.id, v_inv.role, v_inv.discipline, v_inv.invited_by)
        on conflict (project_id, user_id) do nothing;
      update profiles
         set display_name = coalesce(display_name, v_inv.full_name),
             company_name = coalesce(company_name, v_inv.company_name),
             default_discipline = coalesce(default_discipline, v_inv.discipline)
       where user_id = new.id;
      v_accepted := v_accepted + 1;
    end loop;
  end if;

  if v_accepted > 0 then
    return new;
  end if;

  -- New signups auto-provision an org so the app is usable immediately after signup.
  insert into orgs (name, own_afm)
    values (coalesce(new.raw_user_meta_data->>'org_name', 'Η επιχείρησή μου'), '000000000')
    returning id into v_org_id;

  insert into org_members (org_id, user_id, role) values (v_org_id, new.id, 'owner');

  return new;
end;
$$;
