-- 0040: planner -- phases, milestones, tasks (kanban), checklists, comments
--
-- project_notes (0021) carried "action" and "milestone" rows with no owner,
-- no start date and no status beyond resolved/unresolved; 0041 moves them
-- here. Everything in this file hangs off a project, and every child row
-- repeats project_id so RLS is one indexed function call per row instead of
-- a join back through tasks.
--
-- Access is decided in exactly two functions, planner_can_read() and
-- planner_can_write(), so the partner model (0037: project_members, never
-- org_members) plugs in at one place:
--   org viewer   read everything, write nothing
--   org editor+  read and write everything, delete
--   partner      read phases/milestones, read and write tasks, never delete

create type task_status as enum ('todo', 'in_progress', 'waiting', 'review', 'done');
create type task_priority as enum ('low', 'normal', 'high', 'urgent');
create type milestone_kind as enum ('general', 'permit', 'inspection', 'handover', 'deadline');
create type phase_status as enum ('planned', 'active', 'on_hold', 'done');

-- ── can_access_project ─────────────────────────────────────────────────────
-- Owned by 0037 (partners): true for org viewers+ and for invited project
-- members. This branch may run ahead of 0037, so create a viewer-only stub
-- ONLY when the real one is absent -- 0040 sorts after 0037, and a plain
-- `create or replace` here would silently drop partner access.
do $outer$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_access_project'
  ) then
    execute $fn$
      create function public.can_access_project(p_project uuid) returns boolean
      language sql stable security definer set search_path = public as $body$
        -- Stub until 0037 supersedes it: org viewers+ only, no partners.
        select coalesce(has_role((select org_id from projects where id = p_project), 'viewer'), false)
      $body$
    $fn$;
    revoke execute on function public.can_access_project(uuid) from public, anon;
    grant execute on function public.can_access_project(uuid) to authenticated;
  end if;
end $outer$;

-- (id, org_id) is already unique (id is the PK); the explicit constraint
-- lets the planner tables carry a composite FK so a row can never claim one
-- org while pointing at another org's project. Guarded in case a parallel
-- migration (0037+) added the same key first.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.projects'::regclass and conname = 'projects_id_org_id_key'
  ) then
    alter table public.projects add constraint projects_id_org_id_key unique (id, org_id);
  end if;
end $$;

-- ── Access helpers ─────────────────────────────────────────────────────────
-- SECURITY DEFINER because partners cannot read `projects` (it carries
-- financial columns) yet the org has to be resolved from the project id.

create function public.planner_can_read(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(can_access_project(p_project), false)
$$;

-- Editors of the owning org, or someone with project access who is not an
-- org member at all (a partner). Org viewers are members, so they fall
-- through to false: viewer stays read-only even though they can read.
-- 0037's project_members.role (lead/contributor/guest) can narrow the
-- partner branch here without touching any policy.
create function public.planner_can_write(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select has_role(p.org_id, 'editor')
        or (not has_role(p.org_id, 'viewer') and can_access_project(p.id))
    from projects p where p.id = p_project
  ), false)
$$;

-- The projects a caller may plan against, with the non-financial columns
-- only -- the planner's project picker for org users and partners alike.
create function public.planner_projects() returns table(
  id uuid, org_id uuid, code text, display_name text, status project_status,
  start_date date, construction_end_date date, opening_date date, is_active boolean
) language sql stable security definer set search_path = public as $$
  select p.id, p.org_id, p.code, p.display_name, p.status,
         p.start_date, p.construction_end_date, p.opening_date, p.is_active
  from projects p
  where planner_can_read(p.id)
  order by p.sort_order, p.code
$$;

-- Assignable people: members of the project's org plus, once 0037 exists,
-- its invited partners. With p_project null, the members of every org the
-- caller belongs to (the cross-project board). Only display_name/email --
-- never roles -- and nothing at all for a project the caller can't read.
-- project_members is looked up dynamically because this file may be
-- applied before 0037 creates it.
create function public.planner_people(p_project uuid default null) returns table(
  user_id uuid, display_name text, email text
) language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if p_project is null then
    return query
      select distinct pr.user_id, pr.display_name, pr.email
      from org_members m join profiles pr on pr.user_id = m.user_id
      where m.org_id in (select my_org_ids());
    return;
  end if;

  if not planner_can_read(p_project) then
    return;
  end if;
  select org_id into v_org from projects where id = p_project;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_members'
      and column_name in ('project_id', 'user_id')
    group by table_name having count(*) = 2
  ) then
    return query execute
      'select pr.user_id, pr.display_name, pr.email from profiles pr
       where pr.user_id in (
         select m.user_id from org_members m where m.org_id = $1
         union
         select pm.user_id from project_members pm where pm.project_id = $2)'
      using v_org, p_project;
  else
    return query
      select pr.user_id, pr.display_name, pr.email
      from org_members m join profiles pr on pr.user_id = m.user_id
      where m.org_id = v_org;
  end if;
end;
$$;

revoke execute on function public.planner_can_read(uuid) from public, anon;
revoke execute on function public.planner_can_write(uuid) from public, anon;
revoke execute on function public.planner_projects() from public, anon;
revoke execute on function public.planner_people(uuid) from public, anon;
grant execute on function public.planner_can_read(uuid) to authenticated;
grant execute on function public.planner_can_write(uuid) to authenticated;
grant execute on function public.planner_projects() to authenticated;
grant execute on function public.planner_people(uuid) to authenticated;

-- ── Tables ─────────────────────────────────────────────────────────────────

create table project_phases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null,
  name text not null check (btrim(name) <> ''),
  status phase_status not null default 'planned',
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, org_id) references projects (id, org_id) on delete cascade,
  unique (id, project_id),
  constraint phase_planned_range check (planned_end is null or planned_start is null or planned_end >= planned_start),
  constraint phase_actual_range check (actual_end is null or actual_start is null or actual_end >= actual_start)
);

create table project_milestones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null,
  phase_id uuid,
  title text not null check (btrim(title) <> ''),
  description text,
  kind milestone_kind not null default 'general',
  due_date date not null,
  done_at timestamptz,
  -- The project_notes row this came from (0041). No FK: plain action/
  -- milestone notes are deleted after migration and survive only in the
  -- 0041 snapshot table, which is where this id then points.
  source_note_id uuid,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, org_id) references projects (id, org_id) on delete cascade,
  foreign key (phase_id, project_id) references project_phases (id, project_id) on delete set null (phase_id),
  unique (id, project_id)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null,
  phase_id uuid,
  milestone_id uuid,
  title text not null check (btrim(title) <> ''),
  description text,
  status task_status not null default 'todo',
  priority task_priority not null default 'normal',
  assignee_id uuid references auth.users(id) on delete set null,
  start_date date,
  due_date date,
  -- Order within a status column. Fractional so a move writes one row (the
  -- midpoint of its neighbours); src/lib/planner/sortKey.ts rebalances a
  -- column when the gap gets too small to split.
  sort_key double precision not null default 0,
  completed_at timestamptz,
  source_note_id uuid,                -- see project_milestones.source_note_id
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, org_id) references projects (id, org_id) on delete cascade,
  foreign key (phase_id, project_id) references project_phases (id, project_id) on delete set null (phase_id),
  foreign key (milestone_id, project_id) references project_milestones (id, project_id) on delete set null (milestone_id),
  unique (id, project_id),
  constraint task_date_range check (due_date is null or start_date is null or due_date >= start_date)
);

-- Children follow their task across projects (on update cascade); moving a
-- task to another org is refused by planner_guard, so org_id never drifts.
create table task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null,
  task_id uuid not null,
  body text not null check (btrim(body) <> ''),
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, project_id) references tasks (id, project_id) on update cascade on delete cascade
);

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null,
  task_id uuid not null,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, project_id) references tasks (id, project_id) on update cascade on delete cascade
);

create index on project_phases (project_id, sort_order);
create index on project_milestones (project_id, due_date);
create index on project_milestones (org_id, due_date);
create index on project_milestones (phase_id) where phase_id is not null;
create index on tasks (project_id, status, sort_key) where archived_at is null;
create index on tasks (org_id, due_date) where archived_at is null;
create index on tasks (assignee_id) where assignee_id is not null;
create index on tasks (phase_id) where phase_id is not null;
create index on tasks (milestone_id) where milestone_id is not null;
create index on task_checklist_items (task_id, sort_order);
create index on task_comments (task_id, created_at);

create trigger project_phases_set_updated_at before update on project_phases
  for each row execute function set_updated_at();
create trigger project_milestones_set_updated_at before update on project_milestones
  for each row execute function set_updated_at();
create trigger tasks_set_updated_at before update on tasks
  for each row execute function set_updated_at();
create trigger task_checklist_items_set_updated_at before update on task_checklist_items
  for each row execute function set_updated_at();
create trigger task_comments_set_updated_at before update on task_comments
  for each row execute function set_updated_at();

-- ── planner_guard ──────────────────────────────────────────────────────────
-- org_id is always derived from the project, never trusted from the client
-- (partners can't even read it). Re-homing a row to another project is an
-- editor decision even though partners may otherwise update tasks, and a row
-- never leaves its org. auth.uid() is null only for trusted sessions
-- (migrations, service role), which may re-home freely within the org.
create function public.planner_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  -- Nested IFs, not `tg_op = 'UPDATE' and old...`: OLD is null on INSERT
  -- and plpgsql does not promise to short-circuit.
  if tg_op = 'UPDATE' then
    if new.project_id is not distinct from old.project_id and new.org_id is not distinct from old.org_id then
      return new;
    end if;
    if auth.uid() is not null and not has_role(old.org_id, 'editor') then
      raise exception 'only editors may move planner items between projects' using errcode = '42501';
    end if;
  end if;

  select org_id into v_org from projects where id = new.project_id;
  if v_org is null then
    raise exception 'project % not found', new.project_id using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    if v_org <> old.org_id then
      raise exception 'planner items cannot move to another organisation' using errcode = '42501';
    end if;
  end if;
  new.org_id := v_org;
  return new;
end;
$$;
revoke execute on function public.planner_guard() from public, anon, authenticated;

create trigger project_phases_guard before insert or update of project_id, org_id on project_phases
  for each row execute function planner_guard();
create trigger project_milestones_guard before insert or update of project_id, org_id on project_milestones
  for each row execute function planner_guard();
create trigger tasks_guard before insert or update of project_id, org_id on tasks
  for each row execute function planner_guard();
create trigger task_checklist_items_guard before insert or update of project_id, org_id on task_checklist_items
  for each row execute function planner_guard();
create trigger task_comments_guard before insert or update of project_id, org_id on task_comments
  for each row execute function planner_guard();

-- Completion timestamp follows status, so "done when" never depends on the
-- client remembering to send it.
create function public.tasks_track_completion() returns trigger
language plpgsql as $$
begin
  if new.status <> 'done' then
    new.completed_at := null;
  elsif tg_op = 'INSERT' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif old.status <> 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;
create trigger tasks_track_completion before insert or update of status on tasks
  for each row execute function tasks_track_completion();

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table project_phases enable row level security;
alter table project_milestones enable row level security;
alter table tasks enable row level security;
alter table task_checklist_items enable row level security;
alter table task_comments enable row level security;

-- Phases and milestones: the schedule skeleton. Readable by anyone on the
-- project, shaped by org editors only.
create policy project_phases_select on project_phases for select using (planner_can_read(project_id));
create policy project_phases_insert on project_phases for insert with check (has_role(org_id, 'editor'));
create policy project_phases_update on project_phases for update
  using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy project_phases_delete on project_phases for delete using (has_role(org_id, 'editor'));

create policy project_milestones_select on project_milestones for select using (planner_can_read(project_id));
create policy project_milestones_insert on project_milestones for insert with check (has_role(org_id, 'editor'));
create policy project_milestones_update on project_milestones for update
  using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy project_milestones_delete on project_milestones for delete using (has_role(org_id, 'editor'));

-- Tasks: partners work them too, but only the org deletes. Archiving is an
-- update, so a partner can still clear their board.
create policy tasks_select on tasks for select using (planner_can_read(project_id));
create policy tasks_insert on tasks for insert with check (planner_can_write(project_id));
create policy tasks_update on tasks for update
  using (planner_can_write(project_id)) with check (planner_can_write(project_id));
create policy tasks_delete on tasks for delete using (has_role(org_id, 'editor'));

-- A checklist line is part of the task's text, not a record in its own
-- right, so whoever may edit the task may also remove a line.
create policy task_checklist_items_select on task_checklist_items for select using (planner_can_read(project_id));
create policy task_checklist_items_insert on task_checklist_items for insert with check (planner_can_write(project_id));
create policy task_checklist_items_update on task_checklist_items for update
  using (planner_can_write(project_id)) with check (planner_can_write(project_id));
create policy task_checklist_items_delete on task_checklist_items for delete using (planner_can_write(project_id));

-- Comments: anyone who can write the task may comment as themselves; only
-- the author edits; the author or an org editor removes.
create policy task_comments_select on task_comments for select using (planner_can_read(project_id));
create policy task_comments_insert on task_comments for insert
  with check (planner_can_write(project_id) and author_id = auth.uid());
create policy task_comments_update on task_comments for update
  using (author_id = auth.uid() and planner_can_write(project_id))
  with check (author_id = auth.uid() and planner_can_write(project_id));
create policy task_comments_delete on task_comments for delete
  using (author_id = auth.uid() or has_role(org_id, 'editor'));
