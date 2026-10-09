-- 0059: the board assistant -- AI inside the shared collaboration space.
--
-- Everything here is project-scoped exactly like 0038: readable through
-- can_access_project(), never through my_org_ids(), so a partner reaches
-- these rows for their own projects and nothing else. org_id/project_id are
-- always derived from the board (or thread) by trigger, so a client can name
-- a board but never the project RLS is evaluated against.
--
--   collab_ai_threads    conversations on a board, shared by the whole team
--   collab_ai_messages   the user / assistant turns of a thread (text only)
--   collab_ai_proposals  what the assistant suggested: canvas elements to
--                        place, or tasks / milestones to add to the planner.
--                        Nothing is ever written automatically: canvas items
--                        are placed by a user click, planner items by
--                        approve_collab_proposal() run by a lead or editor.
--
-- AI spend: ai_usage (0010) gains project_id; collab rows are written only by
-- log_collab_ai_usage() (partners have no ai_usage rights at all and can't
-- read org-wide spend), and collab_ai_budget_check() answers "may this user
-- spend more?" without revealing any numbers.
--
-- Numbered after the planner (0040) because approve_collab_proposal() inserts
-- into tasks / project_milestones.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table collab_ai_threads (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,          -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,  -- trigger-maintained
  title text check (length(title) <= 200),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collab_ai_threads_board_idx on collab_ai_threads (board_id, updated_at desc);
create index collab_ai_threads_project_idx on collab_ai_threads (project_id);

-- Only the visible text of each turn is stored (tool calls and file bytes
-- are not), so the shared transcript never holds more than the team saw.
create table collab_ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references collab_ai_threads(id) on delete cascade,
  board_id uuid not null references boards(id) on delete cascade,      -- trigger-maintained
  org_id uuid not null references orgs(id) on delete cascade,          -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,  -- trigger-maintained
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 32000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index collab_ai_messages_thread_idx on collab_ai_messages (thread_id, created_at);
create index collab_ai_messages_project_idx on collab_ai_messages (project_id);

create table collab_ai_proposals (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  thread_id uuid references collab_ai_threads(id) on delete set null,
  message_id uuid references collab_ai_messages(id) on delete set null,
  org_id uuid not null references orgs(id) on delete cascade,          -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,  -- trigger-maintained
  kind text not null check (kind in ('canvas', 'tasks', 'milestones')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 256 * 1024),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  -- Ids of the planner rows an approval created.
  result jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz
);
create index collab_ai_proposals_board_idx on collab_ai_proposals (board_id, created_at desc);
create index collab_ai_proposals_project_idx on collab_ai_proposals (project_id);

alter table ai_usage add column project_id uuid references projects(id) on delete set null;
create index ai_usage_user_day_idx on ai_usage (org_id, user_id, created_at) where project_id is not null;

-- ---------------------------------------------------------------------------
-- Anti-spoofing
-- ---------------------------------------------------------------------------
-- Threads and proposals hang off a board: reuse 0038's trigger, which copies
-- org/project from the board under the caller's own RLS (an invisible board
-- -- another project's -- fails the lookup) and makes board_id immutable.
create trigger collab_ai_threads_from_board before insert or update on collab_ai_threads
  for each row execute function collab_child_from_board();
create trigger collab_ai_proposals_from_board before insert or update on collab_ai_proposals
  for each row execute function collab_child_from_board();
create trigger collab_ai_threads_set_updated_at before update on collab_ai_threads
  for each row execute function set_updated_at();

-- Messages hang off a thread, and take board/org/project from it. Invoker
-- rights, as in 0038: a thread the caller can't see doesn't exist here.
create function public.collab_ai_message_from_thread() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.thread_id is distinct from old.thread_id then
    raise exception 'thread_id is immutable' using errcode = '42501';
  end if;
  select t.board_id, t.org_id, t.project_id into new.board_id, new.org_id, new.project_id
  from collab_ai_threads t where t.id = new.thread_id;
  if not found then
    raise exception 'thread % not found', new.thread_id using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger collab_ai_messages_from_thread before insert or update on collab_ai_messages
  for each row execute function collab_ai_message_from_thread();

-- A new message bumps its thread so the panel can list recent threads first.
-- Invoker rights: if the author can't update the thread (a guest replying in
-- someone else's thread), the bump is simply skipped by RLS.
create function public.collab_ai_touch_thread() returns trigger
language plpgsql set search_path = public as $$
begin
  update collab_ai_threads set updated_at = now() where id = new.thread_id;
  return null;
end;
$$;
create trigger collab_ai_messages_touch after insert on collab_ai_messages
  for each row execute function collab_ai_touch_thread();

-- Proposals: the suggestion itself is immutable once made; only its status
-- moves, once, and only by someone entitled to make that decision.
--   pending -> applied              canvas, anyone who may edit the board
--   pending -> approved | rejected  tasks/milestones, a project lead or an
--                                   org editor (milestones: org editor only,
--                                   as 0040's milestone policies require)
--   pending -> rejected             canvas, anyone who may edit the board
create function public.collab_ai_proposals_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_editor boolean;
  v_lead boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.result is not null or new.decided_by is not null or new.decided_at is not null then
      raise exception 'new proposals start pending' using errcode = '42501';
    end if;
    if new.created_by is distinct from auth.uid() then
      raise exception 'created_by must be the caller' using errcode = '42501';
    end if;
    if new.thread_id is not null and not exists (
      select 1 from collab_ai_threads t where t.id = new.thread_id and t.board_id = new.board_id
    ) then
      raise exception 'thread is on another board' using errcode = '42501';
    end if;
    if new.message_id is not null and not exists (
      select 1 from collab_ai_messages m where m.id = new.message_id and m.board_id = new.board_id
    ) then
      raise exception 'message is on another board' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.kind, new.payload, new.created_by, new.created_at)
     is distinct from (old.kind, old.payload, old.created_by, old.created_at) then
    raise exception 'a proposal''s content is immutable' using errcode = '42501';
  end if;
  -- thread/message may only be cleared (on delete set null), never re-pointed.
  if (new.thread_id is not null and new.thread_id is distinct from old.thread_id)
     or (new.message_id is not null and new.message_id is distinct from old.message_id) then
    raise exception 'a proposal cannot move to another thread' using errcode = '42501';
  end if;
  if new.status is not distinct from old.status then
    if new.result is distinct from old.result or new.decided_by is distinct from old.decided_by
       or new.decided_at is distinct from old.decided_at then
      raise exception 'decision fields change only with the status' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'proposal already decided' using errcode = '42501';
  end if;

  v_editor := has_role(new.org_id, 'editor');
  v_lead := exists (
    select 1 from project_members pm
    where pm.project_id = new.project_id and pm.user_id = auth.uid() and pm.role = 'lead'
  );

  if new.kind = 'canvas' then
    if new.status not in ('applied', 'rejected') or not can_edit_collab(new.project_id) then
      raise exception 'not allowed to decide this proposal' using errcode = '42501';
    end if;
  else
    if new.status not in ('approved', 'rejected') then
      raise exception 'invalid status for a planner proposal' using errcode = '42501';
    end if;
    if not (v_editor or (v_lead and new.kind = 'tasks')) then
      raise exception 'only a project lead or an org editor may decide planner proposals' using errcode = '42501';
    end if;
  end if;
  if new.status <> 'approved' and new.result is not null then
    raise exception 'only an approval records a result' using errcode = '42501';
  end if;

  new.decided_by := auth.uid();
  new.decided_at := now();
  return new;
end;
$$;
-- Named to sort after *_from_board so org/project are already filled in.
create trigger collab_ai_proposals_zguard before insert or update on collab_ai_proposals
  for each row execute function collab_ai_proposals_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table collab_ai_threads enable row level security;
alter table collab_ai_messages enable row level security;
alter table collab_ai_proposals enable row level security;

-- Everyone on the project, guests included, may talk to the assistant: the
-- conversation is part of the collaboration, like comments.
create policy collab_ai_threads_select on collab_ai_threads for select using (can_access_project(project_id));
create policy collab_ai_threads_insert on collab_ai_threads for insert
  with check (can_access_project(project_id) and created_by = auth.uid());
create policy collab_ai_threads_update on collab_ai_threads for update
  using (can_access_project(project_id) and (created_by = auth.uid() or can_edit_collab(project_id)))
  with check (can_access_project(project_id));
create policy collab_ai_threads_delete on collab_ai_threads for delete
  using (has_role(org_id, 'editor') or (created_by = auth.uid() and can_access_project(project_id)));

-- Messages are append-only for members; staff editors may clean up.
create policy collab_ai_messages_select on collab_ai_messages for select using (can_access_project(project_id));
create policy collab_ai_messages_insert on collab_ai_messages for insert
  with check (can_access_project(project_id) and created_by = auth.uid());
create policy collab_ai_messages_delete on collab_ai_messages for delete using (has_role(org_id, 'editor'));

create policy collab_ai_proposals_select on collab_ai_proposals for select using (can_access_project(project_id));
create policy collab_ai_proposals_insert on collab_ai_proposals for insert
  with check (can_access_project(project_id) and created_by = auth.uid());
-- Guests never decide anything; the guard trigger narrows the rest.
create policy collab_ai_proposals_update on collab_ai_proposals for update
  using (can_edit_collab(project_id)) with check (can_edit_collab(project_id));
create policy collab_ai_proposals_delete on collab_ai_proposals for delete using (has_role(org_id, 'editor'));

-- ---------------------------------------------------------------------------
-- approve_collab_proposal: turn a tasks/milestones proposal into planner rows
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: the inserts below run under the caller's own RLS (0040:
-- tasks need planner_can_write, milestones need an org editor), so this adds
-- no privilege -- it validates, inserts atomically and records the outcome.
-- project_id always comes from the proposal row (itself derived from the
-- board), never from the payload. p_indexes optionally approves a subset of
-- the proposed items (0-based); null approves all of them.
create function public.approve_collab_proposal(p_proposal uuid, p_indexes int[] default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_p collab_ai_proposals%rowtype;
  v_items jsonb;
  v_item jsonb;
  v_i int;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_sort double precision;
  v_lead boolean;
begin
  -- FOR UPDATE: two approvers clicking at once must not both insert. It also
  -- needs the update policy, so a guest finds nothing here at all.
  select * into v_p from collab_ai_proposals where id = p_proposal for update;
  if not found then
    raise exception 'proposal not found' using errcode = '42501';
  end if;
  if v_p.kind not in ('tasks', 'milestones') then
    raise exception 'only planner proposals are approved here' using errcode = '22023';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'proposal already decided' using errcode = '42501';
  end if;

  v_lead := exists (
    select 1 from project_members pm
    where pm.project_id = v_p.project_id and pm.user_id = auth.uid() and pm.role = 'lead'
  );
  if not (has_role(v_p.org_id, 'editor') or (v_lead and v_p.kind = 'tasks')) then
    raise exception 'only a project lead or an org editor may approve' using errcode = '42501';
  end if;

  v_items := v_p.payload -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'proposal has no items' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 50 then
    raise exception 'too many items (max 50)' using errcode = '54000';
  end if;

  select coalesce(max(t.sort_key), 0) into v_sort
  from tasks t where t.project_id = v_p.project_id and t.status = 'todo' and t.archived_at is null;

  for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
    continue when p_indexes is not null and not (v_i = any (p_indexes));
    v_item := v_items -> v_i;
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item -> 'title'), '') <> 'string'
       or length(btrim(v_item ->> 'title')) not between 1 and 300
       or length(coalesce(v_item ->> 'description', '')) > 4000 then
      raise exception 'malformed item %', v_i using errcode = '22023';
    end if;

    if v_p.kind = 'tasks' then
      v_sort := v_sort + 1;
      insert into tasks (project_id, org_id, title, description, priority, start_date, due_date, sort_key)
      values (
        v_p.project_id,
        v_p.org_id,  -- overwritten by planner_guard from the project anyway
        btrim(v_item ->> 'title'),
        nullif(btrim(coalesce(v_item ->> 'description', '')), ''),
        coalesce(nullif(v_item ->> 'priority', '')::task_priority, 'normal'),
        nullif(v_item ->> 'start_date', '')::date,
        nullif(v_item ->> 'due_date', '')::date,
        v_sort
      )
      returning id into v_id;
    else
      if nullif(v_item ->> 'due_date', '') is null then
        raise exception 'milestone % needs a due_date', v_i using errcode = '22023';
      end if;
      insert into project_milestones (project_id, org_id, title, description, kind, due_date)
      values (
        v_p.project_id,
        v_p.org_id,
        btrim(v_item ->> 'title'),
        nullif(btrim(coalesce(v_item ->> 'description', '')), ''),
        coalesce(nullif(v_item ->> 'kind', '')::milestone_kind, 'general'),
        (v_item ->> 'due_date')::date
      )
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  if cardinality(v_ids) = 0 then
    raise exception 'no items selected' using errcode = '22023';
  end if;

  update collab_ai_proposals
     set status = 'approved',
         result = jsonb_build_object('kind', v_p.kind, 'ids', to_jsonb(v_ids))
   where id = p_proposal;

  return jsonb_build_object('kind', v_p.kind, 'ids', to_jsonb(v_ids));
end;
$$;
revoke execute on function public.approve_collab_proposal(uuid, int[]) from public, anon;
grant execute on function public.approve_collab_proposal(uuid, int[]) to authenticated;

-- ---------------------------------------------------------------------------
-- AI spend for the board assistant
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because partners have no rights on ai_usage (0012: org
-- viewers and up) and must not gain any: they can neither read the org's
-- spend nor insert arbitrary rows. These two functions are the only doors,
-- each re-checking project access first.

-- Day boundaries follow the office's clock, not UTC.
-- Returns 'ok', 'org_budget' (the org's monthly cap is spent) or 'user_cap'
-- (this user's daily cap is spent) -- never the amounts themselves.
-- p_default_monthly_cents is the deployment default (AI_MONTHLY_BUDGET_CENTS);
-- an org's own settings.ai_monthly_budget_cents takes precedence, exactly as
-- in lib/ai/client.ts monthlyBudgetCents().
create function public.collab_ai_budget_check(
  p_project uuid,
  p_user_daily_cents numeric,
  p_default_monthly_cents numeric
) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_cap numeric;
  v_setting text;
  v_org_spent numeric;
  v_user_spent numeric;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens';
begin
  if auth.uid() is null or not can_access_project(p_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.org_id, o.settings ->> 'ai_monthly_budget_cents' into v_org, v_setting
  from projects p join orgs o on o.id = p.org_id where p.id = p_project;

  v_cap := case when v_setting ~ '^[0-9]+(\.[0-9]+)?$' and v_setting::numeric > 0 then v_setting::numeric
                else greatest(coalesce(p_default_monthly_cents, 0), 0) end;

  select coalesce(sum(cost_cents), 0) into v_org_spent
  from ai_usage where org_id = v_org and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  if v_cap > 0 and v_org_spent >= v_cap then
    return 'org_budget';
  end if;

  select coalesce(sum(cost_cents), 0) into v_user_spent
  from ai_usage
  where org_id = v_org and user_id = auth.uid() and project_id is not null and created_at >= v_day_start;
  if coalesce(p_user_daily_cents, 0) > 0 and v_user_spent >= p_user_daily_cents then
    return 'user_cap';
  end if;
  return 'ok';
end;
$$;

-- Records one board-assistant call. user_id is always the caller and the org
-- always the project's, never parameters. The figures come from the server
-- route, but anyone authenticated can call an RPC, so they are bounded: a
-- member can't use this to forge a huge row, and logging stops once a user
-- has recorded more in a day than any legitimate cap would allow -- so a
-- partner can't burn the org's monthly budget by calling this in a loop.
create function public.log_collab_ai_usage(
  p_project uuid,
  p_model text,
  p_input_tokens int,
  p_cache_read_tokens int,
  p_output_tokens int,
  p_cost_cents numeric,
  p_request_id text default null,
  p_latency_ms int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens';
begin
  if auth.uid() is null or not can_access_project(p_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_model is null or length(p_model) not between 1 and 100
     or coalesce(p_input_tokens, -1) < 0 or coalesce(p_cache_read_tokens, 0) < 0 or coalesce(p_output_tokens, -1) < 0
     or coalesce(p_cost_cents, -1) < 0 or p_cost_cents > 1000
     or length(coalesce(p_request_id, '')) > 200 or coalesce(p_latency_ms, 0) < 0 then
    raise exception 'invalid usage figures' using errcode = '22023';
  end if;
  select org_id into v_org from projects where id = p_project;

  if (select coalesce(sum(cost_cents), 0) from ai_usage
      where org_id = v_org and user_id = auth.uid() and project_id is not null and created_at >= v_day_start) > 5000 then
    raise exception 'daily usage ceiling reached' using errcode = '54000';
  end if;

  insert into ai_usage (org_id, project_id, user_id, feature, model, input_tokens, cache_read_tokens,
                        output_tokens, cost_cents, request_id, latency_ms)
  values (v_org, p_project, auth.uid(), 'collab_ai', p_model, p_input_tokens, coalesce(p_cache_read_tokens, 0),
          p_output_tokens, p_cost_cents, p_request_id, p_latency_ms);
end;
$$;

revoke execute on function public.collab_ai_budget_check(uuid, numeric, numeric) from public, anon;
revoke execute on function public.log_collab_ai_usage(uuid, text, int, int, int, numeric, text, int) from public, anon;
grant execute on function public.collab_ai_budget_check(uuid, numeric, numeric) to authenticated;
grant execute on function public.log_collab_ai_usage(uuid, text, int, int, int, numeric, text, int) to authenticated;
