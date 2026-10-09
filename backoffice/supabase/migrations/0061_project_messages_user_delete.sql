-- 0061: let user deletion cascade through project_messages
--
-- 0060's project_messages_guard rejected every change except the text, so
-- `author_id ... on delete set null` raised when an admin deleted a user
-- who had posted in a team chat: partners could not be offboarded. Updates
-- from a JWT-less session (service role, cascades, jobs) now pass through,
-- matching boards_guard. API callers always carry a JWT, so nothing changes
-- for them.

create or replace function public.project_messages_guard() returns trigger
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
    -- No JWT: a cascade from deleting the author (author_id on delete set
    -- null, run by the service role / an admin) or board_id cleared by a
    -- board purge. Without this, a partner who ever posted could never be
    -- deleted. Same pass-through boards_guard gives JWT-less callers.
    if auth.uid() is null then
      return new;
    end if;
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
