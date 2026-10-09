-- 0060: making the collaboration space easy to use -- delete anything (with a
-- safety net), a project team chat, project-level files and board
-- thumbnails/templates.
--
--   boards            a «Κάδος» (trash): deleted_at/deleted_by. Moving to the
--                     trash, restoring and deleting for good are for the
--                     board's creator, a project lead or an org editor.
--                     archived_at is superseded (archived boards move to the
--                     trash once, below). thumbnail_path / template support
--                     the project page's card grid and «Νέος πίνακας».
--   board_files       board_id becomes optional: a file can belong to the
--                     project itself (the Files card, chat attachments),
--                     stored at <org>/<project>/shared/<file>. Leads may
--                     delete any file, not only staff and the uploader.
--   board_comments    leads may delete any comment.
--   collab_ai_threads leads may delete any thread.
--   project_messages  the team chat, one stream per project, fanned out over
--                     the private Realtime topic "project:<uuid>".
--
-- Also fixes a latent bug: set_org_from_project() (0037) read `projects`
-- under the caller's RLS, which a partner cannot see -- so a lead or
-- contributor could neither create a board nor update one (rename, archive).
-- It now resolves the org through collab_project_org(), a definer that
-- returns only the org id and only for a project the caller may access.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The org of a project the caller may access (null otherwise). Only the id:
-- partners already see it through my_collab_projects().
create function public.collab_project_org(p_project uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select p.org_id from projects p where p.id = p_project and can_access_project(p_project)
$$;

-- "May clean up after others": an internal editor (and up) of the owning
-- org, or a partner who leads the project.
create function public.can_manage_collab(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p where p.id = p_project and has_role(p.org_id, 'editor')
  ) or exists (
    select 1 from project_members pm
    where pm.project_id = p_project and pm.user_id = auth.uid() and pm.role = 'lead'
  )
$$;

revoke execute on function public.collab_project_org(uuid) from public, anon;
revoke execute on function public.can_manage_collab(uuid) from public, anon;
grant execute on function public.collab_project_org(uuid) to authenticated;
grant execute on function public.can_manage_collab(uuid) to authenticated;

-- For the anti-spoofing triggers. A JWT caller goes through
-- collab_project_org(); a caller without one (migrations, handle_new_user,
-- service role) reads `projects` with its own rights -- which for those
-- roles bypass RLS, and for anon find nothing. Invoker rights.
create function public.collab_project_org_for_write(p_project uuid) returns uuid
language plpgsql stable set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    select p.org_id into v_org from projects p where p.id = p_project;
    return v_org;
  end if;
  return collab_project_org(p_project);
end;
$$;

-- Invoker rights as before (the caller still has to be able to reach the
-- project), but no longer through `projects` RLS, which hides every project
-- from a partner. For admins (project_members, project_invites) nothing
-- changes: they can access every project of their org.
create or replace function public.set_org_from_project() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'project_id is immutable' using errcode = '42501';
  end if;
  new.org_id := collab_project_org_for_write(new.project_id);
  if new.org_id is null then
    raise exception 'project % not found', new.project_id using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Boards: trash, thumbnails, templates
-- ---------------------------------------------------------------------------
alter table boards
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete set null,
  add column thumbnail_path text,
  -- The template a board was created from, applied once by its creator's
  -- browser on first open (Excalidraw elements are built client-side) and
  -- then cleared.
  add column template text check (template in ('brainstorm', 'moodboard', 'review', 'todo'));
create index boards_trash_idx on boards (deleted_at) where deleted_at is not null;

comment on column boards.archived_at is 'Superseded by deleted_at (0060); kept for history.';

-- Archived boards had no way back; give them one (30 days in the trash).
update boards set deleted_at = now() where archived_at is not null and deleted_at is null;

-- Invoker rights. RLS (boards_update: can_edit_collab) decides whether the
-- caller may touch the board at all; this narrows the trash columns to the
-- creator, a lead or an org editor, and stamps who did it. Callers without a
-- JWT (migrations, the purge job, service role) pass through.
create function public.boards_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.deleted_at is not null or new.deleted_by is not null or new.thumbnail_path is not null then
      raise exception 'new boards start outside the trash and without a thumbnail' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable' using errcode = '42501';
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if not (can_manage_collab(new.project_id) or old.created_by = auth.uid()) then
      raise exception 'only the board''s creator, a project lead or an editor may move it to or from the trash'
        using errcode = '42501';
    end if;
    if new.deleted_at is not null then
      new.deleted_at := now();
      new.deleted_by := auth.uid();
    else
      new.deleted_by := null;
    end if;
  else
    new.deleted_by := old.deleted_by;
  end if;

  -- The only object a board row may point at is its own thumbnail.
  if new.thumbnail_path is not null
     and new.thumbnail_path <> new.org_id::text || '/' || new.project_id::text || '/' || new.id::text || '/thumbnail.png' then
    raise exception 'thumbnail_path outside its board folder' using errcode = '42501';
  end if;

  if new.template is not null and new.template is distinct from old.template then
    raise exception 'template can only be cleared' using errcode = '42501';
  end if;
  return new;
end;
$$;
-- Named to sort after boards_set_org so org_id is already filled in.
create trigger boards_zguard before insert or update on boards
  for each row execute function boards_guard();

-- Deleting for good: always a second step, from the trash, by the same
-- people who may trash it (org editors keep their unconditional right from
-- 0038). A plain RLS policy rather than a definer function: the delete runs
-- entirely under the caller's own rights, and cascades to elements,
-- comments, files rows and assistant threads exactly as before.
drop policy boards_delete on boards;
create policy boards_delete on boards for delete using (
  has_role(org_id, 'editor')
  or (deleted_at is not null
      and can_edit_collab(project_id)
      and (can_manage_collab(project_id) or created_by = auth.uid()))
);

-- ---------------------------------------------------------------------------
-- Files: project-level files and lead deletes
-- ---------------------------------------------------------------------------
alter table board_files alter column board_id drop not null;
create unique index board_files_project_file_uq on board_files (project_id, file_id) where board_id is null;

-- Board files take org/project from their board (as 0038's
-- collab_child_from_board); project files from their project. Invoker
-- rights: a board or project the caller can't reach doesn't exist here.
create function public.board_files_scope() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.board_id is distinct from old.board_id or new.project_id is distinct from old.project_id) then
    raise exception 'board_id and project_id are immutable' using errcode = '42501';
  end if;
  if new.board_id is not null then
    select b.org_id, b.project_id into new.org_id, new.project_id from boards b where b.id = new.board_id;
    if not found then
      raise exception 'board % not found', new.board_id using errcode = '42501';
    end if;
  else
    new.org_id := collab_project_org_for_write(new.project_id);
    if new.org_id is null then
      raise exception 'project % not found', new.project_id using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger board_files_from_board on board_files;
create trigger board_files_from_board before insert or update on board_files
  for each row execute function board_files_scope();

-- Board files under <org>/<project>/<board>/, project files under
-- <org>/<project>/shared/.
create or replace function public.board_files_path_check() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.storage_path not like new.org_id::text || '/' || new.project_id::text || '/'
                               || coalesce(new.board_id::text, 'shared') || '/%'
     or new.storage_path like '%..%' then
    raise exception 'storage_path outside its board folder' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop policy board_files_delete on board_files;
create policy board_files_delete on board_files for delete using (
  can_manage_collab(project_id) or (created_by = auth.uid() and can_edit_collab(project_id))
);

-- 0038's path check, plus the project-level "shared" folder.
create or replace function public.collab_path_ok(p_name text, p_write boolean) returns boolean
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
     or v_parts[1] !~ v_uuid or v_parts[2] !~ v_uuid
     or (v_parts[3] !~ v_uuid and v_parts[3] <> 'shared')
     or v_parts[4] !~ '^[A-Za-z0-9._-]{1,160}$' or v_parts[4] like '%..%' then
    return false;
  end if;

  if v_parts[3] = 'shared' then
    select p.id into v_project from projects p where p.id = v_parts[2]::uuid and p.org_id = v_parts[1]::uuid;
  else
    select b.project_id into v_project
    from boards b
    where b.id = v_parts[3]::uuid and b.project_id = v_parts[2]::uuid and b.org_id = v_parts[1]::uuid;
  end if;
  if not found then
    return false;
  end if;

  return case when p_write then can_edit_collab(v_project) else can_access_project(v_project) end;
end;
$$;

-- Removing someone else's object: a lead or an org editor, or -- once a board
-- is in the trash -- its creator (deleting the board for good clears its
-- folder first). The uploader's own objects are allowed by the policy.
create function public.collab_path_manage_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[];
  v_project uuid;
  v_trashed_by_me boolean := false;
begin
  if not coalesce(collab_path_ok(p_name, true), false) then
    return false;
  end if;
  v_parts := string_to_array(p_name, '/');
  v_project := v_parts[2]::uuid;
  if v_parts[3] <> 'shared' then
    select b.deleted_at is not null and b.created_by = auth.uid() into v_trashed_by_me
    from boards b where b.id = v_parts[3]::uuid;
  end if;
  return can_manage_collab(v_project) or coalesce(v_trashed_by_me, false);
end;
$$;
revoke execute on function public.collab_path_manage_ok(text) from public, anon;
grant execute on function public.collab_path_manage_ok(text) to authenticated;

-- 0038 let anyone who may upload delete any object in the project. Narrow it
-- to the object's uploader, a lead or an editor. storage.objects.owner_id is
-- the current column; very old Storage versions only had `owner`.
drop policy collab_bucket_delete on storage.objects;
do $$
declare
  v_owner text := case
    when exists (select 1 from information_schema.columns
                 where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id')
      then 'owner_id'
    else 'owner::text'
  end;
begin
  execute format($p$
    create policy collab_bucket_delete on storage.objects for delete to authenticated
      using (bucket_id = 'collab' and public.collab_path_ok(name, true)
             and (%s = auth.uid()::text or public.collab_path_manage_ok(name)))
  $p$, v_owner);
end $$;

-- Board thumbnails are overwritten in place (upload with upsert), which
-- Storage authorizes as an UPDATE. Nothing else in the bucket is ever
-- updated.
create policy collab_bucket_thumbnail_update on storage.objects for update to authenticated
  using (bucket_id = 'collab' and split_part(name, '/', 3) <> 'shared'
         and split_part(name, '/', 4) = 'thumbnail.png' and public.collab_path_ok(name, true))
  with check (bucket_id = 'collab' and split_part(name, '/', 3) <> 'shared'
              and split_part(name, '/', 4) = 'thumbnail.png' and public.collab_path_ok(name, true));

-- ---------------------------------------------------------------------------
-- Comments and assistant threads: leads clean up too
-- ---------------------------------------------------------------------------
drop policy board_comments_delete on board_comments;
create policy board_comments_delete on board_comments for delete
  using (author_id = auth.uid() or can_manage_collab(project_id));

drop policy collab_ai_threads_delete on collab_ai_threads;
create policy collab_ai_threads_delete on collab_ai_threads for delete
  using (can_manage_collab(project_id) or (created_by = auth.uid() and can_access_project(project_id)));

-- ---------------------------------------------------------------------------
-- Team chat
-- ---------------------------------------------------------------------------
create table project_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,          -- trigger-maintained
  project_id uuid not null references projects(id) on delete cascade,
  -- Optional "posted from this board" link.
  board_id uuid references boards(id) on delete set null,
  body text not null default '' check (length(body) <= 4000),
  -- board_files ids (project files, usually). A deleted file simply stops
  -- resolving; the client shows it as removed.
  attachment_ids uuid[] not null default '{}' check (cardinality(attachment_ids) <= 10),
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint project_messages_not_empty check (length(btrim(body)) > 0 or cardinality(attachment_ids) > 0)
);
create index project_messages_project_idx on project_messages (project_id, created_at desc);

-- Invoker rights, like 0038's anti-spoofing triggers: org comes from the
-- project, a linked board must be one of the project's, attachments must be
-- files of the same project the caller can see. Only the author edits the
-- text; nothing else ever changes.
create function public.project_messages_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.org_id := collab_project_org_for_write(new.project_id);
    if new.org_id is null then
      raise exception 'project % not found', new.project_id using errcode = '42501';
    end if;
    new.created_at := now();
    new.edited_at := null;
  else
    if (new.project_id, new.board_id, new.author_id, new.attachment_ids, new.created_at)
       is distinct from (old.project_id, old.board_id, old.author_id, old.attachment_ids, old.created_at) then
      -- board_id may only be cleared (on delete set null).
      if not (new.board_id is null and old.board_id is not null
              and (new.project_id, new.author_id, new.attachment_ids, new.created_at)
                  is not distinct from (old.project_id, old.author_id, old.attachment_ids, old.created_at)) then
        raise exception 'only the text of a message can change' using errcode = '42501';
      end if;
    end if;
    new.org_id := old.org_id;
    if new.body is distinct from old.body then
      if old.author_id is distinct from auth.uid() then
        raise exception 'only the author can edit a message' using errcode = '42501';
      end if;
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
    return new;
  end if;

  if new.board_id is not null and not exists (
    select 1 from boards b where b.id = new.board_id and b.project_id = new.project_id
  ) then
    raise exception 'board is not part of this project' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(new.attachment_ids) a(id)
    where not exists (select 1 from board_files f where f.id = a.id and f.project_id = new.project_id)
  ) then
    raise exception 'attachment is not a file of this project' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger project_messages_guard before insert or update on project_messages
  for each row execute function project_messages_guard();

alter table project_messages enable row level security;

-- Guests chat too: the conversation is part of the collaboration.
create policy project_messages_select on project_messages for select using (can_access_project(project_id));
create policy project_messages_insert on project_messages for insert
  with check (can_access_project(project_id) and author_id = auth.uid());
create policy project_messages_update on project_messages for update
  using (author_id = auth.uid() and can_access_project(project_id))
  with check (author_id = auth.uid() and can_access_project(project_id));
create policy project_messages_delete on project_messages for delete
  using ((author_id = auth.uid() and can_access_project(project_id)) or can_manage_collab(project_id));

-- ---------------------------------------------------------------------------
-- Realtime: private topic "project:<uuid>" for the team chat
-- ---------------------------------------------------------------------------
-- Receive and presence need project access. Nobody broadcasts on it from a
-- client -- there is no insert policy for 'broadcast' here, and the board
-- policy (realtime_board_topic_ok) rejects this topic -- so every message
-- event comes from the trigger below and can't be forged.
create function public.realtime_project_topic_ok(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_topic is null
     or p_topic !~ '^project:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return can_access_project(substr(p_topic, 9)::uuid);
end;
$$;
revoke execute on function public.realtime_project_topic_ok(text) from public, anon;
grant execute on function public.realtime_project_topic_ok(text) to authenticated;

-- SECURITY DEFINER for the same reason as broadcast_board_comment (0038):
-- realtime.messages takes no inserts from the posting user.
create function public.broadcast_project_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.broadcast_changes(
      'project:' || coalesce(new.project_id, old.project_id)::text,
      'message_' || lower(tg_op),
      tg_op,
      tg_table_name,
      tg_table_schema,
      new,
      old
    );
  exception when others then
    raise warning 'project message broadcast failed: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.broadcast_project_message() from public, anon, authenticated;

-- Guarded like 0038: realtime objects may be missing in a bare local stack.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy collab_project_receive on realtime.messages for select to authenticated
        using (extension in ('broadcast', 'presence') and public.realtime_project_topic_ok(realtime.topic()))
    $p$;
    execute $p$
      create policy collab_project_presence on realtime.messages for insert to authenticated
        with check (extension = 'presence' and public.realtime_project_topic_ok(realtime.topic()))
    $p$;
  else
    raise notice 'realtime.messages not present; project channel policies skipped';
  end if;

  if to_regprocedure('realtime.broadcast_changes(text, text, text, text, text, record, record, text)') is not null then
    execute $t$
      create trigger project_messages_broadcast after insert or update or delete on public.project_messages
        for each row execute function public.broadcast_project_message()
    $t$;
  else
    raise notice 'realtime.broadcast_changes not present; project message broadcast trigger skipped';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Trash purge: boards deleted more than 30 days ago go for good, nightly.
-- ---------------------------------------------------------------------------
-- Runs as the job owner (no JWT), so boards_guard and RLS don't apply. The
-- bucket objects of a purged board are left behind: Storage objects must be
-- removed through the Storage API, and with the board row gone
-- collab_path_ok() refuses every path under it, so they are unreachable.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-collab-trash',
      '40 3 * * *',
      $c$ delete from public.boards where deleted_at < now() - interval '30 days' $c$
    );
  else
    raise notice 'pg_cron not installed; collab trash purge not scheduled';
  end if;
end $$;
