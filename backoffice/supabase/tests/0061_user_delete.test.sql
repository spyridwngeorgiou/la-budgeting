-- Deleting a user who created boards and posted in team chat (0061).
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000061a1', 'owner-61@test.local');
create temp table t61 as
  select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000061a1';

insert into projects (id, org_id, code, display_name)
select '00000000-0000-0000-0000-0000000061f1', org_id, 'P61', 'Έργο 61' from t61;
insert into project_invites (project_id, email, role)
values ('00000000-0000-0000-0000-0000000061f1', 'partner-61@test.local', 'contributor');
insert into auth.users (id, email, invited_at)
values ('00000000-0000-0000-0000-0000000061c1', 'partner-61@test.local', now());

insert into boards (id, org_id, project_id, title, created_by)
select '00000000-0000-0000-0000-0000000061b1', org_id, '00000000-0000-0000-0000-0000000061f1',
       'Πίνακας συνεργάτη', '00000000-0000-0000-0000-0000000061c1' from t61;
insert into project_messages (id, org_id, project_id, body, author_id)
select '00000000-0000-0000-0000-0000000061e1', org_id, '00000000-0000-0000-0000-0000000061f1',
       'Καλημέρα', '00000000-0000-0000-0000-0000000061c1' from t61;

-- As an admin offboarding the partner does it: no JWT (service role).
select lives_ok(
  $$ delete from auth.users where id = '00000000-0000-0000-0000-0000000061c1' $$,
  'a partner who created a board and posted in chat can be deleted');
select is((select author_id from project_messages where id = '00000000-0000-0000-0000-0000000061e1'),
  null, 'their chat message stays, without an author');
select is((select created_by from boards where id = '00000000-0000-0000-0000-0000000061b1'),
  null, 'their board stays, without a creator');
select is((select count(*) from project_members where user_id = '00000000-0000-0000-0000-0000000061c1')::int,
  0, 'their project membership is gone');

select * from finish();
rollback;
