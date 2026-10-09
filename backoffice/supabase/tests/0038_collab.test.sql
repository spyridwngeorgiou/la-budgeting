-- Collaboration boards (0038): element merge rule, guest limits,
-- board_id spoofing, storage paths and realtime topics.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(34);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Owner A, outsider X (own org); contributor C and guest G invited to P1.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'outsider@test.local');

create temp table t_ctx as
  select org_id as org_a from org_members where user_id = '00000000-0000-0000-0000-0000000000a1';
grant select on t_ctx to authenticated;

insert into projects (id, org_id, code, display_name)
select '00000000-0000-0000-0000-0000000000f1', org_a, 'P1', 'Έργο 1' from t_ctx;
insert into projects (id, org_id, code, display_name)
select '00000000-0000-0000-0000-0000000000f2', org_a, 'P2', 'Έργο 2' from t_ctx;

insert into project_invites (project_id, email, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'contrib@test.local', 'contributor'),
  ('00000000-0000-0000-0000-0000000000f1', 'guest@test.local', 'guest');
insert into auth.users (id, email, invited_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'contrib@test.local', now()),
  ('00000000-0000-0000-0000-0000000000d1', 'guest@test.local', now());

insert into boards (id, project_id, title) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000f1', 'Κάτοψη'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000000f2', 'Άλλο έργο');

select is((select org_id from boards where id = '00000000-0000-0000-0000-00000000b001'),
  (select org_a from t_ctx), 'board org_id comes from its project');

-- ---- contributor ----------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');

select is(
  upsert_board_elements('00000000-0000-0000-0000-00000000b001',
    '[{"id":"e1","type":"rectangle","version":1,"versionNonce":10}]'),
  '[]'::jsonb, 'contributor writes a new element');
select is(
  jsonb_array_length(upsert_board_elements('00000000-0000-0000-0000-00000000b001',
    '[{"id":"e1","type":"rectangle","version":1,"versionNonce":20}]')),
  1, 'same version, higher nonce is rejected');
select is(
  upsert_board_elements('00000000-0000-0000-0000-00000000b001',
    '[{"id":"e1","type":"rectangle","version":1,"versionNonce":20}]') -> 0 ->> 'versionNonce',
  '10', 'rejection returns the winning server copy');
select is(
  upsert_board_elements('00000000-0000-0000-0000-00000000b001',
    '[{"id":"e1","type":"rectangle","version":1,"versionNonce":5}]'),
  '[]'::jsonb, 'same version, lower nonce wins');
select is(
  upsert_board_elements('00000000-0000-0000-0000-00000000b001',
    '[{"id":"e1","type":"rectangle","version":3,"versionNonce":99,"isDeleted":true}]'),
  '[]'::jsonb, 'higher version wins');
select is(
  jsonb_array_length(upsert_board_elements('00000000-0000-0000-0000-00000000b001',
    '[{"id":"e1","type":"rectangle","version":2,"versionNonce":1}]')),
  1, 'stale lower version is rejected');
select ok((select is_deleted and version = 3 from board_elements where element_id = 'e1'),
  'tombstone and version stored');
select is((select project_id from board_elements where element_id = 'e1'),
  '00000000-0000-0000-0000-0000000000f1'::uuid, 'element project_id comes from its board');

select throws_ok(
  $$ select upsert_board_elements('00000000-0000-0000-0000-00000000b001',
       '[{"id":"e2","version":1,"versionNonce":1,"dataURL":"data:image/png;base64,AAAA"}]') $$,
  '22023', null, 'elements carrying a dataURL are refused');
select throws_ok(
  $$ select upsert_board_elements('00000000-0000-0000-0000-00000000b001', '{"id":"e2"}') $$,
  '22023', null, 'non-array payload is refused');

-- Spoofing: naming a board of another project, whatever project_id is sent.
select throws_ok(
  $$ select upsert_board_elements('00000000-0000-0000-0000-00000000b002',
       '[{"id":"x","version":1,"versionNonce":1}]') $$,
  '42501', null, 'cannot upsert into another project''s board');
select throws_ok(
  $$ insert into board_elements (board_id, element_id, org_id, project_id, version, version_nonce, data)
     select '00000000-0000-0000-0000-00000000b002', 'x', org_a, '00000000-0000-0000-0000-0000000000f1', 1, 1, '{}'
     from t_ctx $$,
  '42501', null, 'board_id spoofing on board_elements is rejected');
select throws_ok(
  $$ insert into board_comments (board_id, org_id, project_id, body)
     select '00000000-0000-0000-0000-00000000b002', org_a, '00000000-0000-0000-0000-0000000000f1', 'hi'
     from t_ctx $$,
  '42501', null, 'board_id spoofing on board_comments is rejected');
select throws_ok(
  $$ insert into board_files (board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes)
     select '00000000-0000-0000-0000-00000000b001', org_a, '00000000-0000-0000-0000-0000000000f1', 'f1',
            org_a::text || '/00000000-0000-0000-0000-0000000000f2/00000000-0000-0000-0000-00000000b002/f1.png',
            'image/png', 10
     from t_ctx $$,
  '42501', null, 'board_files path must sit under its own board');
select throws_ok(
  $$ update boards set project_id = '00000000-0000-0000-0000-0000000000f2'
     where id = '00000000-0000-0000-0000-00000000b001' $$,
  '42501', null, 'boards cannot be moved to another project');

select ok(collab_path_ok((select org_a from t_ctx)::text
  || '/00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000b001/a.png', true),
  'contributor may write into own board folder');
select ok(not collab_path_ok((select org_a from t_ctx)::text
  || '/00000000-0000-0000-0000-0000000000f2/00000000-0000-0000-0000-00000000b001/a.png', false),
  'path with mismatched project is refused');
select ok(not collab_path_ok((select org_a from t_ctx)::text || '/receipt.jpg', false),
  'non-board path is refused');

select ok(realtime_board_topic_ok('board:00000000-0000-0000-0000-00000000b001', true),
  'contributor may broadcast on own board topic');
select ok(not realtime_board_topic_ok('board:00000000-0000-0000-0000-00000000b002', false),
  'contributor cannot join another project''s board topic');
select ok(not realtime_board_topic_ok('board:not-a-uuid', false), 'malformed topic returns false');
select ok(not realtime_board_topic_ok('board:00000000-0000-0000-0000-00000000b001:x', false),
  'topic with trailing junk returns false');
select ok(not realtime_board_topic_ok('room:00000000-0000-0000-0000-00000000b001', false),
  'foreign topic prefix returns false');
reset role;

-- ---- guest ----------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');

select throws_ok(
  $$ select upsert_board_elements('00000000-0000-0000-0000-00000000b001',
       '[{"id":"g1","version":1,"versionNonce":1}]') $$,
  '42501', null, 'guest cannot upsert elements');
select throws_ok(
  $$ insert into boards (project_id, title) values ('00000000-0000-0000-0000-0000000000f1', 'Νέος') $$,
  '42501', null, 'guest cannot create boards');
select lives_ok(
  $$ insert into board_comments (board_id, body, scene_x, scene_y)
     values ('00000000-0000-0000-0000-00000000b001', 'Τι ύψος έχει το παράθυρο;', 10, 20) $$,
  'guest can comment');
select ok(realtime_board_topic_ok('board:00000000-0000-0000-0000-00000000b001', false),
  'guest may receive / track presence on the board topic');
select ok(not realtime_board_topic_ok('board:00000000-0000-0000-0000-00000000b001', true),
  'guest may not broadcast element deltas');
select ok(not collab_path_ok((select org_a from t_ctx)::text
  || '/00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000b001/a.png', true),
  'guest may not upload files');
reset role;

-- ---- contributor vs guest's comment -----------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$ update board_comments set body = 'άλλο' where board_id = '00000000-0000-0000-0000-00000000b001' $$,
  '42501', null, 'only the author edits a comment');
select lives_ok(
  $$ update board_comments set resolved_at = now() where board_id = '00000000-0000-0000-0000-00000000b001' $$,
  'an editor can resolve someone else''s thread');
select throws_ok(
  $$ insert into project_activity (org_id, project_id, kind)
     select org_a, '00000000-0000-0000-0000-0000000000f1', 'board_created' from t_ctx $$,
  '42501', null, 'activity cannot be forged');
reset role;

-- ---- outsider (another org) -----------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is((select count(*) from boards)::int + (select count(*) from board_elements)::int
          + (select count(*) from board_comments)::int + (select count(*) from project_activity)::int,
  0, 'a user of another org sees no boards, elements, comments or activity');
reset role;

select * from finish();
rollback;
