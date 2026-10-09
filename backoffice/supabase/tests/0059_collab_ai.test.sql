-- Board assistant (0059): thread/message/proposal isolation between orgs and
-- projects, board_id spoofing, who may approve planner proposals, and the
-- AI-spend definers.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(30);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Owner A (org A) and owner B (org B, a different customer). Lead L,
-- contributor C and guest G are partners invited to A's project PA only.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@test.local');

create temp table t_ctx as
  select (select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000000a1') as org_a,
         (select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000000b1') as org_b;
grant select on t_ctx to authenticated;

insert into projects (id, org_id, code, display_name)
select '00000000-0000-0000-0000-0000000000f1', org_a, 'PA', 'Έργο Α' from t_ctx;
insert into projects (id, org_id, code, display_name)
select '00000000-0000-0000-0000-0000000000f2', org_b, 'PB', 'Έργο Β' from t_ctx;

insert into project_invites (project_id, email, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'lead@test.local', 'lead'),
  ('00000000-0000-0000-0000-0000000000f1', 'contrib@test.local', 'contributor'),
  ('00000000-0000-0000-0000-0000000000f1', 'guest@test.local', 'guest');
insert into auth.users (id, email, invited_at) values
  ('00000000-0000-0000-0000-0000000000c0', 'lead@test.local', now()),
  ('00000000-0000-0000-0000-0000000000c1', 'contrib@test.local', now()),
  ('00000000-0000-0000-0000-0000000000d1', 'guest@test.local', now());

insert into boards (id, project_id, title) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000f1', 'Κάτοψη Α'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000000f2', 'Κάτοψη Β');

-- ---- org B writes its own conversation -------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok(
  $$ insert into collab_ai_threads (id, board_id, org_id, project_id, title)
     select '00000000-0000-0000-0000-0000000a0b01', '00000000-0000-0000-0000-00000000b002', org_b,
            '00000000-0000-0000-0000-0000000000f2', 'Β' from t_ctx $$,
  'owner B starts a thread on their board');
select lives_ok(
  $$ insert into collab_ai_messages (thread_id, board_id, org_id, project_id, role, content)
     select '00000000-0000-0000-0000-0000000a0b01', '00000000-0000-0000-0000-00000000b002', org_b,
            '00000000-0000-0000-0000-0000000000f2', 'user', 'Μυστικό του Β' from t_ctx $$,
  'owner B writes a message');
select lives_ok(
  $$ insert into collab_ai_proposals (board_id, org_id, project_id, kind, payload)
     select '00000000-0000-0000-0000-00000000b002', org_b, '00000000-0000-0000-0000-0000000000f2',
            'tasks', '{"items":[{"title":"Β εργασία"}]}' from t_ctx $$,
  'owner B stores a proposal');
reset role;

-- ---- lead of A -------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c0');

select is((select count(*) from collab_ai_threads)::int, 0, 'partner of A sees none of B''s threads');
select is((select count(*) from collab_ai_messages)::int, 0, 'partner of A sees none of B''s messages');
select is((select count(*) from collab_ai_proposals)::int, 0, 'partner of A sees none of B''s proposals');

select lives_ok(
  $$ insert into collab_ai_threads (id, board_id, org_id, project_id)
     select '00000000-0000-0000-0000-0000000a0a01', '00000000-0000-0000-0000-00000000b001', org_a,
            '00000000-0000-0000-0000-0000000000f1' from t_ctx $$,
  'lead starts a thread on their project''s board');
select is((select project_id from collab_ai_threads where id = '00000000-0000-0000-0000-0000000a0a01'),
  '00000000-0000-0000-0000-0000000000f1'::uuid, 'thread project comes from its board');
select lives_ok(
  $$ insert into collab_ai_messages (thread_id, board_id, org_id, project_id, role, content)
     select '00000000-0000-0000-0000-0000000a0a01', '00000000-0000-0000-0000-00000000b002', org_b,
            '00000000-0000-0000-0000-0000000000f2', 'user', 'Σύνοψη πίνακα' from t_ctx $$,
  'lead writes a message (spoofed board/project ignored)');
select is((select board_id from collab_ai_messages where content = 'Σύνοψη πίνακα'),
  '00000000-0000-0000-0000-00000000b001'::uuid, 'message board comes from its thread, not the client');

-- Spoofing: naming another org's board or thread, whatever project is sent.
select throws_ok(
  $$ insert into collab_ai_threads (board_id, org_id, project_id)
     select '00000000-0000-0000-0000-00000000b002', org_a, '00000000-0000-0000-0000-0000000000f1' from t_ctx $$,
  '42501', null, 'spoofed board_id on threads is rejected');
select throws_ok(
  $$ insert into collab_ai_messages (thread_id, board_id, org_id, project_id, role, content)
     select '00000000-0000-0000-0000-0000000a0b01', '00000000-0000-0000-0000-00000000b001', org_a,
            '00000000-0000-0000-0000-0000000000f1', 'user', 'x' from t_ctx $$,
  '42501', null, 'cannot post into another org''s thread');
select throws_ok(
  $$ insert into collab_ai_proposals (board_id, org_id, project_id, kind, payload)
     select '00000000-0000-0000-0000-00000000b002', org_a, '00000000-0000-0000-0000-0000000000f1',
            'tasks', '{"items":[]}' from t_ctx $$,
  '42501', null, 'spoofed board_id on proposals is rejected');
select throws_ok(
  $$ insert into collab_ai_proposals (board_id, thread_id, org_id, project_id, kind, payload)
     select '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000a0b01', org_a,
            '00000000-0000-0000-0000-0000000000f1', 'tasks', '{"items":[]}' from t_ctx $$,
  '42501', null, 'proposal cannot point at another board''s thread');

-- AI spend definers.
select throws_ok(
  $$ select log_collab_ai_usage('00000000-0000-0000-0000-0000000000f2', 'claude-opus-5', 10, 0, 10, 0.1) $$,
  '42501', null, 'log_collab_ai_usage rejects an inaccessible project');
select throws_ok(
  $$ select collab_ai_budget_check('00000000-0000-0000-0000-0000000000f2', 50, 10000) $$,
  '42501', null, 'collab_ai_budget_check rejects an inaccessible project');
select lives_ok(
  $$ select log_collab_ai_usage('00000000-0000-0000-0000-0000000000f1', 'claude-opus-5', 1000, 0, 500, 1.75, 'req_1', 900) $$,
  'log_collab_ai_usage records a call for the own project');
select throws_ok(
  $$ select log_collab_ai_usage('00000000-0000-0000-0000-0000000000f1', 'claude-opus-5', 1, 0, 1, 99999) $$,
  '22023', null, 'implausible cost is refused');
select is(collab_ai_budget_check('00000000-0000-0000-0000-0000000000f1', 50, 10000), 'ok', 'within budget');
select is(collab_ai_budget_check('00000000-0000-0000-0000-0000000000f1', 1, 10000), 'user_cap',
  'per-user daily cap is enforced');
select is((select count(*) from ai_usage)::int, 0, 'partner cannot read ai_usage, not even own rows');
reset role;

-- ---- contributor proposes; contributor and guest cannot approve -------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into collab_ai_proposals (id, board_id, org_id, project_id, kind, payload)
select '00000000-0000-0000-0000-0000000a0c01', '00000000-0000-0000-0000-00000000b001', org_a,
       '00000000-0000-0000-0000-0000000000f1', 'tasks',
       '{"items":[{"title":"Μέτρηση ανοιγμάτων","due_date":"2026-11-01"},{"title":"Παραγγελία κουφωμάτων","priority":"high"}]}'
from t_ctx;
insert into collab_ai_proposals (id, board_id, org_id, project_id, kind, payload)
select '00000000-0000-0000-0000-0000000a0c02', '00000000-0000-0000-0000-00000000b001', org_a,
       '00000000-0000-0000-0000-0000000000f1', 'milestones',
       '{"items":[{"title":"Άδεια","due_date":"2026-12-01","kind":"permit"}]}'
from t_ctx;

select throws_ok(
  $$ select approve_collab_proposal('00000000-0000-0000-0000-0000000a0c01') $$,
  '42501', null, 'contributor cannot approve');
select throws_ok(
  $$ update collab_ai_proposals set status = 'approved' where id = '00000000-0000-0000-0000-0000000a0c01' $$,
  '42501', null, 'contributor cannot mark a planner proposal approved directly');
select throws_ok(
  $$ update collab_ai_proposals set payload = '{"items":[{"title":"άλλο"}]}'
     where id = '00000000-0000-0000-0000-0000000a0c01' $$,
  '42501', null, 'proposal content is immutable');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok(
  $$ select approve_collab_proposal('00000000-0000-0000-0000-0000000a0c01') $$,
  '42501', null, 'guest cannot approve');
reset role;

-- ---- lead approves tasks, not milestones -----------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c0');
select is(jsonb_array_length(approve_collab_proposal('00000000-0000-0000-0000-0000000a0c01') -> 'ids'), 2,
  'lead approves the task proposal');
select is((select count(*) from tasks where project_id = '00000000-0000-0000-0000-0000000000f1')::int, 2,
  'approval created the tasks in the proposal''s project');
select is((select status from collab_ai_proposals where id = '00000000-0000-0000-0000-0000000a0c01'), 'approved',
  'proposal is marked approved');
select throws_ok(
  $$ select approve_collab_proposal('00000000-0000-0000-0000-0000000a0c02') $$,
  '42501', null, 'milestones need an org editor, not a partner lead');
reset role;

-- ---- owner of A sees the usage row with project and user -------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is(
  (select count(*) from ai_usage
   where project_id = '00000000-0000-0000-0000-0000000000f1'
     and user_id = '00000000-0000-0000-0000-0000000000c0' and feature = 'collab_ai')::int,
  1, 'org owner sees the partner''s collab usage row');
reset role;

select * from finish();
rollback;
