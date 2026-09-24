-- 0024: activity log -- who did what, when, and what changed.
--
-- Written only by triggers (security definer), never by the app, so it is a
-- record nobody can edit: there are no insert/update/delete policies. Read by
-- admins and owners only.
--
-- Actor: the signed-in user (auth.uid()). Writes made with the service-role
-- key (scripts run by Claude on the owner's behalf) carry no user, so they are
-- attributed to the email sent in the x-actor-email request header and marked
-- via = 'claude'.

create table activity_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  via text not null check (via in ('app', 'claude', 'system')),
  action text not null check (action in ('insert', 'update', 'delete')),
  entity text not null,                 -- table name
  entity_id uuid,
  project_id uuid references projects(id) on delete set null,
  label text,                           -- what the row is called (description, name, title…)
  changes jsonb                         -- update: {column: [old, new]}; insert/delete: null
);
create index activity_log_org_at_idx on activity_log (org_id, at desc);
create index activity_log_project_idx on activity_log (project_id, at desc);

alter table activity_log enable row level security;
create policy activity_log_select on activity_log for select using (has_role(org_id, 'admin'));

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_uid uuid := auth.uid();
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_changes jsonb;
  v_email text;
  k text;
begin
  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'search_key', 'signed_amount', 'month_key', 'fingerprint')
         and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  end if;

  if v_uid is not null then
    select email into v_email from auth.users where id = v_uid;
  else
    v_email := v_headers ->> 'x-actor-email';
  end if;

  insert into activity_log (org_id, actor_id, actor_email, via, action, entity, entity_id, project_id, label, changes)
  values (
    (v_row ->> 'org_id')::uuid,
    v_uid,
    v_email,
    case when v_uid is not null then 'app' when v_email is not null then 'claude' else 'system' end,
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    case when tg_table_name = 'projects' then (v_row ->> 'id')::uuid else (v_row ->> 'project_id')::uuid end,
    coalesce(v_row ->> 'description', v_row ->> 'label', v_row ->> 'title', v_row ->> 'name',
             v_row ->> 'display_name', v_row ->> 'lender', v_row ->> 'source', v_row ->> 'body'),
    v_changes
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'transactions', 'accounts', 'contacts', 'projects', 'categories', 'installment_plans',
    'project_files', 'project_notes', 'project_budgets', 'assets', 'liabilities', 'expected_income',
    'loans', 'org_members'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function log_activity()',
      t || '_activity', t);
  end loop;
end $$;

-- Sign-ins come from Supabase Auth's own audit trail, limited to members of
-- the caller's org and to admins/owners.
create or replace function public.org_sign_ins(p_org uuid, p_since timestamptz default now() - interval '90 days')
returns table (at timestamptz, user_id uuid, email text)
language sql stable security definer set search_path = public, auth as $$
  select e.created_at, u.id, u.email
  from auth.audit_log_entries e
  join auth.users u on u.id::text = e.payload ->> 'actor_id'
  join org_members m on m.user_id = u.id and m.org_id = p_org
  where has_role(p_org, 'admin')
    and e.payload ->> 'action' = 'login'
    and e.created_at >= p_since
  order by e.created_at desc
$$;
