-- 0081: saved history for the back-office assistant (/assistant).
--
-- Unlike the board assistant's threads (0059, shared by a project team),
-- these are private: a conversation is visible only to the user who had it,
-- and only while they are still a member of its org. No elevated function
-- touches these tables; the chat route reads and writes them with the
-- caller's own RLS-scoped client.
--
--   ai_conversations   one row per chat, titled from its first question
--   ai_messages        the visible user / assistant turns (text only, plus
--                      a small meta object: proposal ids, source links,
--                      tools used), so a reloaded chat looks like it did

create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text check (length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_user_idx on ai_conversations (user_id, org_id, updated_at desc);

create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,                               -- trigger-maintained
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,     -- trigger-maintained
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 32000),
  meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 64 * 1024),
  created_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on ai_messages (conversation_id, created_at);

-- A message always belongs to its conversation's org and owner, whatever
-- the client sent; and writing one bumps the conversation in the list.
create function public.ai_messages_pin() returns trigger
language plpgsql set search_path = public as $$
declare
  v_org uuid;
  v_user uuid;
begin
  select org_id, user_id into v_org, v_user from ai_conversations where id = new.conversation_id;
  if v_org is null then
    raise exception 'conversation not found' using errcode = '23503';
  end if;
  new.org_id := v_org;
  new.user_id := v_user;
  update ai_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;
create trigger ai_messages_pin before insert on ai_messages
  for each row execute function ai_messages_pin();

create trigger ai_conversations_set_updated_at before update on ai_conversations
  for each row execute function set_updated_at();

alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;

create policy ai_conversations_select on ai_conversations for select
  using (user_id = auth.uid() and has_role(org_id, 'viewer'));
create policy ai_conversations_insert on ai_conversations for insert
  with check (user_id = auth.uid() and has_role(org_id, 'viewer'));
create policy ai_conversations_update on ai_conversations for update
  using (user_id = auth.uid() and has_role(org_id, 'viewer'))
  with check (user_id = auth.uid() and has_role(org_id, 'viewer'));
create policy ai_conversations_delete on ai_conversations for delete
  using (user_id = auth.uid() and has_role(org_id, 'viewer'));

-- Messages are append-only from the app (no update policy).
create policy ai_messages_select on ai_messages for select
  using (user_id = auth.uid() and has_role(org_id, 'viewer'));
create policy ai_messages_insert on ai_messages for insert
  with check (user_id = auth.uid() and has_role(org_id, 'viewer'));
create policy ai_messages_delete on ai_messages for delete
  using (user_id = auth.uid() and has_role(org_id, 'viewer'));
