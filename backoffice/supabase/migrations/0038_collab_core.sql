-- 0038: the shared collaboration space -- Excalidraw boards per project,
-- their files and comments, and a per-project activity feed.
--
-- Every table here is readable by can_access_project() and writable by
-- can_edit_collab() (0037), never by my_org_ids(), so partners reach these
-- and nothing else. org_id/project_id on child rows are always copied from
-- the parent board by trigger: a client can name a board, but never the
-- project or org that board-scoped RLS is evaluated against.

create table boards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,          -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  -- Scene-level settings shared by everyone (background colour, grid);
  -- per-user view state (scroll, zoom, selection) never leaves the browser.
  app_state jsonb not null default '{}',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, project_id)
);
create index boards_project_idx on boards (project_id);
create trigger boards_set_org before insert or update on boards
  for each row execute function set_org_from_project();
create trigger boards_set_updated_at before update on boards
  for each row execute function set_updated_at();

-- One row per Excalidraw element. `data` is the element exactly as
-- Excalidraw serialises it; version/version_nonce/is_deleted are lifted out
-- so the merge in upsert_board_elements() can compare without parsing.
-- Image elements only reference a fileId -- binaries live in the `collab`
-- bucket, never as data URLs in here.
create table board_elements (
  board_id uuid not null references boards(id) on delete cascade,
  element_id text not null check (length(element_id) between 1 and 64),
  org_id uuid not null references orgs(id) on delete cascade,          -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,  -- trigger-maintained
  version int not null,
  version_nonce bigint not null,
  is_deleted boolean not null default false,
  data jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (board_id, element_id)
);
create index board_elements_project_idx on board_elements (project_id);

create table board_files (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,          -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,  -- trigger-maintained
  file_id text not null check (length(file_id) between 1 and 128),     -- Excalidraw's FileId
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size_bytes int not null check (size_bytes between 1 and 26214400),
  original_name text check (length(original_name) <= 255),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (board_id, file_id)
);
create index board_files_project_idx on board_files (project_id);

-- Threads: a root comment (parent_id null) anchored either to an element
-- or to a free scene point, plus flat replies. Resolving is per thread.
create table board_comments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,          -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,  -- trigger-maintained
  parent_id uuid references board_comments(id) on delete cascade,
  element_id text check (length(element_id) <= 64),
  scene_x double precision,
  scene_y double precision,
  body text not null check (length(btrim(body)) between 1 and 4000),
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create index board_comments_board_idx on board_comments (board_id, created_at);

create table project_activity (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  board_id uuid references boards(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,          -- board_created | file_uploaded | comment_added | member_added
  summary text,
  created_at timestamptz not null default now()
);
create index project_activity_project_idx on project_activity (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Anti-spoofing: child rows inherit org/project from their board.
-- ---------------------------------------------------------------------------
-- Invoker rights: if the caller can't see the board (another project's), the
-- lookup finds nothing and the write fails here, before RLS even runs. If
-- they can see it but not edit it, RLS's with-check rejects it next.
create function public.collab_child_from_board() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.board_id is distinct from old.board_id then
    raise exception 'board_id is immutable' using errcode = '42501';
  end if;
  select b.org_id, b.project_id into new.org_id, new.project_id from boards b where b.id = new.board_id;
  if not found then
    raise exception 'board % not found', new.board_id using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger board_elements_from_board before insert or update on board_elements
  for each row execute function collab_child_from_board();
create trigger board_files_from_board before insert or update on board_files
  for each row execute function collab_child_from_board();
create trigger board_comments_from_board before insert or update on board_comments
  for each row execute function collab_child_from_board();

create function public.board_elements_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
create trigger board_elements_stamp before insert or update on board_elements
  for each row execute function board_elements_stamp();

-- Files must sit under <org>/<project>/<board>/ of their own board, so a row
-- can't point a signed-URL lookup at someone else's object.
create function public.board_files_path_check() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.storage_path not like new.org_id::text || '/' || new.project_id::text || '/' || new.board_id::text || '/%'
     or new.storage_path like '%..%' then
    raise exception 'storage_path outside its board folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
-- Named to sort after *_from_board so org/project are already filled in.
create trigger board_files_zpath before insert or update on board_files
  for each row execute function board_files_path_check();

-- Only the author edits a comment's text or anchor; anyone who may resolve
-- (editors, or the author) only toggles resolved_*. Replies stay on the
-- parent's board.
create function public.board_comments_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from board_comments c where c.id = new.parent_id and c.board_id = new.board_id
  ) then
    raise exception 'parent comment is on another board' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.author_id is distinct from old.author_id then
      raise exception 'author_id is immutable' using errcode = '42501';
    end if;
    if (new.body, new.element_id, new.scene_x, new.scene_y, new.parent_id)
       is distinct from (old.body, old.element_id, old.scene_x, old.scene_y, old.parent_id)
       and old.author_id is distinct from auth.uid() then
      raise exception 'only the author can edit a comment' using errcode = '42501';
    end if;
    new.updated_at := now();
    if new.resolved_at is not null and old.resolved_at is null then
      new.resolved_by := auth.uid();
    elsif new.resolved_at is null then
      new.resolved_by := null;
    end if;
  end if;
  return new;
end;
$$;
create trigger board_comments_zguard before insert or update on board_comments
  for each row execute function board_comments_guard();

-- ---------------------------------------------------------------------------
-- Activity feed: written only by these triggers. SECURITY DEFINER because
-- project_activity has no insert policy at all -- nobody, partner or staff,
-- can forge an entry through the API.
-- ---------------------------------------------------------------------------
create function public.log_project_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'boards' then
    insert into project_activity (org_id, project_id, board_id, actor_id, kind, summary)
      values (new.org_id, new.project_id, new.id, auth.uid(), 'board_created', left(new.title, 200));
  elsif tg_table_name = 'board_files' then
    insert into project_activity (org_id, project_id, board_id, actor_id, kind, summary)
      values (new.org_id, new.project_id, new.board_id, auth.uid(), 'file_uploaded', left(new.original_name, 200));
  elsif tg_table_name = 'board_comments' then
    insert into project_activity (org_id, project_id, board_id, actor_id, kind, summary)
      values (new.org_id, new.project_id, new.board_id, auth.uid(), 'comment_added', left(new.body, 140));
  elsif tg_table_name = 'project_members' then
    insert into project_activity (org_id, project_id, actor_id, kind, summary)
      values (new.org_id, new.project_id, coalesce(auth.uid(), new.invited_by), 'member_added',
              (select left(coalesce(display_name, company_name), 200) from profiles where user_id = new.user_id));
  end if;
  return null;
end;
$$;
revoke execute on function public.log_project_activity() from public, anon, authenticated;

create trigger boards_activity after insert on boards
  for each row execute function log_project_activity();
create trigger board_files_activity after insert on board_files
  for each row execute function log_project_activity();
create trigger board_comments_activity after insert on board_comments
  for each row execute function log_project_activity();
create trigger project_members_activity after insert on project_members
  for each row execute function log_project_activity();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table boards enable row level security;
alter table board_elements enable row level security;
alter table board_files enable row level security;
alter table board_comments enable row level security;
alter table project_activity enable row level security;

create policy boards_select on boards for select using (can_access_project(project_id));
create policy boards_insert on boards for insert with check (can_edit_collab(project_id));
create policy boards_update on boards for update
  using (can_edit_collab(project_id)) with check (can_edit_collab(project_id));
-- Hard delete wipes every element and comment: staff only. Partners archive.
create policy boards_delete on boards for delete using (has_role(org_id, 'editor'));

-- No delete policy: Excalidraw deletes are tombstones (is_deleted), which
-- must survive so a stale client can't resurrect the element.
create policy board_elements_select on board_elements for select using (can_access_project(project_id));
create policy board_elements_insert on board_elements for insert with check (can_edit_collab(project_id));
create policy board_elements_update on board_elements for update
  using (can_edit_collab(project_id)) with check (can_edit_collab(project_id));

create policy board_files_select on board_files for select using (can_access_project(project_id));
create policy board_files_insert on board_files for insert
  with check (can_edit_collab(project_id) and created_by = auth.uid());
create policy board_files_delete on board_files for delete
  using (has_role(org_id, 'editor') or (created_by = auth.uid() and can_edit_collab(project_id)));

-- Guests may comment: insert needs access, not edit rights.
create policy board_comments_select on board_comments for select using (can_access_project(project_id));
create policy board_comments_insert on board_comments for insert
  with check (can_access_project(project_id) and author_id = auth.uid());
create policy board_comments_update on board_comments for update
  using (author_id = auth.uid() or can_edit_collab(project_id))
  with check (can_access_project(project_id));
create policy board_comments_delete on board_comments for delete
  using (author_id = auth.uid() or has_role(org_id, 'editor'));

create policy project_activity_select on project_activity for select using (can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- upsert_board_elements: the only write path the canvas uses.
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: the insert/update below runs under the caller's RLS, so
-- this is a convenience (one round trip, server-side merge), not a privilege.
--
-- Merge rule is Excalidraw's own reconcile rule: the higher `version` wins;
-- on a tie the lower `versionNonce` wins. Elements that lose are returned
-- with the server's copy so the client can reconcile instead of silently
-- diverging.
create function public.upsert_board_elements(p_board uuid, p_elements jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_project uuid;
  v_rejected jsonb;
begin
  if p_elements is null or jsonb_typeof(p_elements) <> 'array' then
    raise exception 'p_elements must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_elements) > 2000 then
    raise exception 'too many elements in one call (max 2000)' using errcode = '54000';
  end if;
  if octet_length(p_elements::text) > 5 * 1024 * 1024 then
    raise exception 'payload too large (max 5 MB)' using errcode = '54000';
  end if;

  select b.project_id into v_project from boards b where b.id = p_board;
  if not found or not can_edit_collab(v_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_elements) e
    -- coalesce: a missing key yields null, and null must count as malformed.
    where jsonb_typeof(e) <> 'object'
       or coalesce(jsonb_typeof(e->'id'), '') <> 'string'
       or length(e->>'id') not between 1 and 64
       or coalesce(jsonb_typeof(e->'version'), '') <> 'number'
       or coalesce(jsonb_typeof(e->'versionNonce'), '') <> 'number'
       or octet_length(e::text) > 512 * 1024
       or e ? 'dataURL'
  ) then
    raise exception 'malformed or oversized element' using errcode = '22023';
  end if;

  if (select count(*) from board_elements where board_id = p_board) > 20000 then
    raise exception 'board element limit reached' using errcode = '54000';
  end if;

  with incoming as (
    -- A client batch can carry the same element twice; keep its best copy.
    select distinct on (e->>'id')
      e->>'id' as element_id,
      (e->>'version')::int as version,
      (e->>'versionNonce')::bigint as version_nonce,
      coalesce((e->>'isDeleted')::boolean, false) as is_deleted,
      e as data
    from jsonb_array_elements(p_elements) e
    order by e->>'id', (e->>'version')::int desc, (e->>'versionNonce')::bigint asc
  ),
  written as (
    insert into board_elements as b (board_id, element_id, version, version_nonce, is_deleted, data)
    select p_board, i.element_id, i.version, i.version_nonce, i.is_deleted, i.data from incoming i
    on conflict (board_id, element_id) do update
      set version = excluded.version,
          version_nonce = excluded.version_nonce,
          is_deleted = excluded.is_deleted,
          data = excluded.data
      where excluded.version > b.version
         or (excluded.version = b.version and excluded.version_nonce < b.version_nonce)
    returning b.element_id
  )
  -- The outer query sees the pre-statement snapshot, which for a rejected
  -- element is exactly the server copy that beat it.
  select coalesce(jsonb_agg(cur.data), '[]'::jsonb) into v_rejected
  from incoming i
  join board_elements cur on cur.board_id = p_board and cur.element_id = i.element_id
  where not exists (select 1 from written w where w.element_id = i.element_id);

  return v_rejected;
end;
$$;
revoke execute on function public.upsert_board_elements(uuid, jsonb) from public, anon;
grant execute on function public.upsert_board_elements(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private `collab` bucket, objects at <org>/<project>/<board>/<file>
-- ---------------------------------------------------------------------------
-- 25 MB, raster images and PDF only. SVG is excluded on purpose: it can
-- carry script and would be served from our storage origin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('collab', 'collab', false, 26214400, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Parses the object path defensively (it's evaluated for objects in every
-- bucket, so it must never throw) and checks the three ids agree with a
-- real board before applying the project-level access rule.
create function public.collab_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[];
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_project uuid;
begin
  if p_name is null then
    return false;
  end if;
  v_parts := string_to_array(p_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 4
     or v_parts[1] !~ v_uuid or v_parts[2] !~ v_uuid or v_parts[3] !~ v_uuid
     or v_parts[4] !~ '^[A-Za-z0-9._-]{1,160}$' or v_parts[4] like '%..%' then
    return false;
  end if;

  select b.project_id into v_project
  from boards b
  where b.id = v_parts[3]::uuid and b.project_id = v_parts[2]::uuid and b.org_id = v_parts[1]::uuid;
  if not found then
    return false;
  end if;

  return case when p_write then can_edit_collab(v_project) else can_access_project(v_project) end;
end;
$$;
revoke execute on function public.collab_path_ok(text, boolean) from public, anon;
grant execute on function public.collab_path_ok(text, boolean) to authenticated;

create policy collab_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'collab' and public.collab_path_ok(name, false));
create policy collab_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'collab' and public.collab_path_ok(name, true));
create policy collab_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'collab' and public.collab_path_ok(name, true));

-- ---------------------------------------------------------------------------
-- Realtime: private channels, one per board, topic "board:<uuid>"
-- ---------------------------------------------------------------------------
-- Receiving and presence (cursors, who's here) need project access. Sending
-- broadcasts (element deltas) needs edit rights: other clients merge
-- received elements into their scene and then persist them under their own
-- identity, so letting a guest broadcast would let a guest write.
create function public.realtime_board_topic_ok(p_topic text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_project uuid;
begin
  if p_topic is null
     or p_topic !~ '^board:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  select b.project_id into v_project from boards b where b.id = substr(p_topic, 7)::uuid;
  if not found then
    return false;
  end if;
  return case when p_write then can_edit_collab(v_project) else can_access_project(v_project) end;
end;
$$;
revoke execute on function public.realtime_board_topic_ok(text, boolean) from public, anon;
grant execute on function public.realtime_board_topic_ok(text, boolean) to authenticated;

-- Comment changes are pushed to the board's channel from the database, so
-- clients don't have to poll and a guest's comment reaches everyone even
-- though guests can't broadcast themselves. SECURITY DEFINER because
-- realtime.broadcast_changes() writes to realtime.messages, which the
-- commenting user (a guest, possibly) has no insert right on.
create function public.broadcast_board_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A live-update hiccup (e.g. Realtime's daily message partition not yet
  -- created) must never cost the user their comment; clients also refetch
  -- comments on reconnect.
  begin
    perform realtime.broadcast_changes(
      'board:' || coalesce(new.board_id, old.board_id)::text,
      'comment_' || lower(tg_op),
      tg_op,
      tg_table_name,
      tg_table_schema,
      new,
      old
    );
  exception when others then
    raise warning 'board comment broadcast failed: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.broadcast_board_comment() from public, anon, authenticated;

-- realtime.messages / realtime.broadcast_changes are created by the Realtime
-- service, which a bare `supabase db start` (CI) doesn't necessarily run.
-- Hosted projects always have them; skip cleanly where they don't exist so
-- the pgTAP suite can still run against everything else.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy collab_board_receive on realtime.messages for select to authenticated
        using (extension in ('broadcast', 'presence') and public.realtime_board_topic_ok(realtime.topic(), false))
    $p$;
    execute $p$
      create policy collab_board_presence on realtime.messages for insert to authenticated
        with check (extension = 'presence' and public.realtime_board_topic_ok(realtime.topic(), false))
    $p$;
    execute $p$
      create policy collab_board_broadcast on realtime.messages for insert to authenticated
        with check (extension = 'broadcast' and public.realtime_board_topic_ok(realtime.topic(), true))
    $p$;
  else
    raise notice 'realtime.messages not present; board channel policies skipped';
  end if;

  if to_regprocedure('realtime.broadcast_changes(text, text, text, text, text, record, record, text)') is not null then
    execute $t$
      create trigger board_comments_broadcast after insert or update or delete on public.board_comments
        for each row execute function public.broadcast_board_comment()
    $t$;
  else
    raise notice 'realtime.broadcast_changes not present; comment broadcast trigger skipped';
  end if;
end $$;
