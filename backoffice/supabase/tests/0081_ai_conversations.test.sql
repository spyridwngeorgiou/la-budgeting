-- Saved assistant history is private to its user (0081).
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

-- A and B in their own orgs; C is a second member of A's org.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000081a0', 'a81@test.local'),
  ('00000000-0000-0000-0000-0000000081b0', 'b81@test.local'),
  ('00000000-0000-0000-0000-0000000081c0', 'c81@test.local');

create temp table t_org as
  select user_id, org_id from org_members
  where user_id in ('00000000-0000-0000-0000-0000000081a0', '00000000-0000-0000-0000-0000000081b0');
grant select on t_org to authenticated;

insert into org_members (org_id, user_id, role)
select org_id, '00000000-0000-0000-0000-0000000081c0', 'editor' from t_org
where user_id = '00000000-0000-0000-0000-0000000081a0';

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- A starts a conversation and writes a turn.
select pg_temp.as_user('00000000-0000-0000-0000-0000000081a0');
insert into ai_conversations (id, org_id, title)
select '81000000-0000-0000-0000-000000000001', org_id, 'Θέση ΦΠΑ' from t_org
where user_id = '00000000-0000-0000-0000-0000000081a0';
insert into ai_messages (conversation_id, org_id, role, content)
select '81000000-0000-0000-0000-000000000001', org_id, 'user', 'Ποια είναι η θέση ΦΠΑ;' from t_org
where user_id = '00000000-0000-0000-0000-0000000081a0';
select is((select count(*) from ai_messages)::int, 1, 'A reads own messages');
select is((select count(*) from ai_conversations)::int, 1, 'A reads own conversation');
reset role;

-- B (another org) sees nothing and cannot append to A's conversation.
select pg_temp.as_user('00000000-0000-0000-0000-0000000081b0');
select is((select count(*) from ai_conversations)::int, 0, 'B cannot read A conversations');
select is((select count(*) from ai_messages)::int, 0, 'B cannot read A messages');
select throws_ok(
  $$ insert into ai_messages (conversation_id, org_id, role, content)
     select '81000000-0000-0000-0000-000000000001', org_id, 'assistant', 'forged' from t_org
     where user_id = '00000000-0000-0000-0000-0000000081b0' $$,
  '23503', null, 'B cannot write into A conversation');
reset role;

-- C is in the same org as A, yet history is per user.
select pg_temp.as_user('00000000-0000-0000-0000-0000000081c0');
select is((select count(*) from ai_conversations)::int, 0, 'same-org colleague cannot read A conversations');
select is((select count(*) from ai_messages)::int, 0, 'same-org colleague cannot read A messages');
select throws_ok(
  $$ insert into ai_conversations (org_id, user_id, title)
     select org_id, '00000000-0000-0000-0000-0000000081a0', 'forged' from t_org
     where user_id = '00000000-0000-0000-0000-0000000081a0' $$,
  '42501', null, 'cannot create a conversation on behalf of someone else');
reset role;

-- Message org/user are pinned from the conversation.
select is(
  (select user_id from ai_messages where conversation_id = '81000000-0000-0000-0000-000000000001' limit 1),
  '00000000-0000-0000-0000-0000000081a0'::uuid,
  'message owner is pinned from the conversation');

select * from finish();
rollback;
