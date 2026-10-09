-- Collaboration usability (0060): the board trash (who may trash, restore and
-- delete for good), file / comment / thread deletes by leads, project-level
-- files, the team chat's RLS and anti-spoofing, and the project realtime
-- topic checker.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(69);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Owner A (org A, an org editor and up) and outsider X (own org). Lead L,
-- contributors C and C2 and guest G are partners on P1 only; P2 is another
-- project of the same org they are not on.
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
  ('00000000-0000-0000-0000-0000000000f1', 'lead@test.local', 'lead'),
  ('00000000-0000-0000-0000-0000000000f1', 'contrib@test.local', 'contributor'),
  ('00000000-0000-0000-0000-0000000000f1', 'contrib2@test.local', 'contributor'),
  ('00000000-0000-0000-0000-0000000000f1', 'guest@test.local', 'guest');
insert into auth.users (id, email, invited_at) values
  ('00000000-0000-0000-0000-0000000000c0', 'lead@test.local', now()),
  ('00000000-0000-0000-0000-0000000000c1', 'contrib@test.local', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'contrib2@test.local', now()),
  ('00000000-0000-0000-0000-0000000000d1', 'guest@test.local', now());

-- b001 by C, b002 and b005 by C2, b003 by the owner (all P1); b004 on P2.
insert into boards (id, project_id, title, created_by) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000f1', 'Του C', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000000f1', 'Του C2', '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-0000000000f1', 'Του A', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000b004', '00000000-0000-0000-0000-0000000000f2', 'Άλλο έργο', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000b005', '00000000-0000-0000-0000-0000000000f1', 'Επίσης του C2', '00000000-0000-0000-0000-0000000000c2');

-- Files on b003 by C and by C2; a project file of P2.
insert into board_files (id, board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes, created_by)
select '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000b003', org_a,
       '00000000-0000-0000-0000-0000000000f1', 'fc',
       org_a::text || '/00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000b003/fc.png',
       'image/png', 10, '00000000-0000-0000-0000-0000000000c1' from t_ctx;
insert into board_files (id, board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes, created_by)
select '00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000b003', org_a,
       '00000000-0000-0000-0000-0000000000f1', 'fc2',
       org_a::text || '/00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000b003/fc2.png',
       'image/png', 10, '00000000-0000-0000-0000-0000000000c2' from t_ctx;
insert into board_files (id, board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes, created_by)
select '00000000-0000-0000-0000-0000000f0003', null, org_a,
       '00000000-0000-0000-0000-0000000000f2', 'p2',
       org_a::text || '/00000000-0000-0000-0000-0000000000f2/shared/p2.pdf',
       'application/pdf', 10, '00000000-0000-0000-0000-0000000000a1' from t_ctx;

-- A comment and an assistant thread by C on b003; a chat message on P2.
insert into board_comments (id, board_id, org_id, project_id, body, author_id)
select '00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000b003', org_a,
       '00000000-0000-0000-0000-0000000000f1', 'Σχόλιο του C', '00000000-0000-0000-0000-0000000000c1' from t_ctx;
insert into board_comments (id, board_id, org_id, project_id, body, author_id)
select '00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-00000000b003', org_a,
       '00000000-0000-0000-0000-0000000000f1', 'Άλλο σχόλιο του C', '00000000-0000-0000-0000-0000000000c1' from t_ctx;
insert into collab_ai_threads (id, board_id, org_id, project_id, title, created_by)
select '00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-00000000b003', org_a,
       '00000000-0000-0000-0000-0000000000f1', 'Νήμα του C', '00000000-0000-0000-0000-0000000000c1' from t_ctx;
insert into project_messages (id, org_id, project_id, body, author_id)
select '00000000-0000-0000-0000-0000000ee002', org_a, '00000000-0000-0000-0000-0000000000f2',
       'Μόνο για το P2', '00000000-0000-0000-0000-0000000000a1' from t_ctx;

select is((select org_id from board_files where id = '00000000-0000-0000-0000-0000000f0003'),
  (select org_a from t_ctx), 'project file org_id comes from its project');

-- ---- contributor C ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');

select lives_ok(
  $$ insert into boards (id, project_id, title, created_by)
     values ('00000000-0000-0000-0000-00000000b0c1', '00000000-0000-0000-0000-0000000000f1', 'Νέος',
             '00000000-0000-0000-0000-0000000000c0') $$,
  'a contributor can create a board (org resolved without projects RLS)');
select is((select created_by from boards where id = '00000000-0000-0000-0000-00000000b0c1'),
  '00000000-0000-0000-0000-0000000000c1'::uuid, 'created_by is the caller, whatever was sent');
select throws_ok(
  $$ insert into boards (project_id, title) values ('00000000-0000-0000-0000-0000000000f2', 'Ξένο') $$,
  '42501', null, 'cannot create a board in a project one is not on');

select lives_ok(
  $$ update boards set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b001' $$,
  'creator moves own board to the trash');
select is((select deleted_by from boards where id = '00000000-0000-0000-0000-00000000b001'),
  '00000000-0000-0000-0000-0000000000c1'::uuid, 'deleted_by is stamped with the caller');
select lives_ok(
  $$ update boards set deleted_at = null where id = '00000000-0000-0000-0000-00000000b001' $$,
  'creator restores own board');
select ok((select deleted_at is null and deleted_by is null from boards where id = '00000000-0000-0000-0000-00000000b001'),
  'restored board is out of the trash');
select lives_ok(
  $$ update boards set deleted_by = '00000000-0000-0000-0000-0000000000c0' where id = '00000000-0000-0000-0000-00000000b001' $$,
  'writing deleted_by alone is accepted...');
select is((select deleted_by from boards where id = '00000000-0000-0000-0000-00000000b001'), null::uuid,
  '...but ignored');

select lives_ok(
  $$ delete from boards where id = '00000000-0000-0000-0000-00000000b001' $$,
  'deleting a live board runs');
select ok(exists (select 1 from boards where id = '00000000-0000-0000-0000-00000000b001'),
  'a board outside the trash is not deleted by its creator');
update boards set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b001';
delete from boards where id = '00000000-0000-0000-0000-00000000b001';
select ok(not exists (select 1 from boards where id = '00000000-0000-0000-0000-00000000b001'),
  'creator deletes own trashed board for good');

select throws_ok(
  $$ update boards set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b002' $$,
  '42501', null, 'a contributor cannot trash someone else''s board');

select throws_ok(
  $$ update boards set template = 'todo' where id = '00000000-0000-0000-0000-00000000b0c1' $$,
  '42501', null, 'a template cannot be set after creation');
select throws_ok(
  $$ update boards set thumbnail_path = 'x/y/z/thumbnail.png' where id = '00000000-0000-0000-0000-00000000b0c1' $$,
  '42501', null, 'thumbnail_path must be the board''s own thumbnail');
select lives_ok(
  $$ update boards set thumbnail_path = org_id::text || '/' || project_id::text || '/' || id::text || '/thumbnail.png'
     where id = '00000000-0000-0000-0000-00000000b0c1' $$,
  'the board''s own thumbnail path is accepted');

select is((select count(*) from project_messages)::int, 0, 'partner sees no messages of another project');
select ok(realtime_project_topic_ok('project:00000000-0000-0000-0000-0000000000f1'),
  'partner may receive on own project topic');
select ok(not realtime_project_topic_ok('project:00000000-0000-0000-0000-0000000000f2'),
  'partner cannot join another project''s topic');
select ok(not realtime_project_topic_ok('project:00000000-0000-0000-0000-0000000000f1:x'),
  'topic with trailing junk returns false');
select ok(not realtime_project_topic_ok('board:00000000-0000-0000-0000-0000000000f1'),
  'foreign topic prefix returns false');
select ok(not realtime_board_topic_ok('project:00000000-0000-0000-0000-0000000000f1', true),
  'nobody may broadcast on a project topic through the board rule');
reset role;

-- ---- guest G ------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');

update boards set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b002';
select ok((select deleted_at is null from boards where id = '00000000-0000-0000-0000-00000000b002'),
  'a guest cannot trash a board');

select lives_ok(
  $$ insert into project_messages (id, org_id, project_id, body)
     select '00000000-0000-0000-0000-0000000ee001', org_a, '00000000-0000-0000-0000-0000000000f1', 'Καλημέρα!' from t_ctx $$,
  'a guest can post in the team chat');
select is((select author_id from project_messages where id = '00000000-0000-0000-0000-0000000ee001'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'author defaults to the caller');
select throws_ok(
  $$ insert into project_messages (org_id, project_id, body)
     select org_a, '00000000-0000-0000-0000-0000000000f2', 'x' from t_ctx $$,
  '42501', null, 'cannot post into another project');
select throws_ok(
  $$ insert into project_messages (org_id, project_id, body, author_id)
     select org_a, '00000000-0000-0000-0000-0000000000f1', 'x', '00000000-0000-0000-0000-0000000000c0' from t_ctx $$,
  '42501', null, 'cannot post as someone else');
select throws_ok(
  $$ insert into project_messages (org_id, project_id, board_id, body)
     select org_a, '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000b004', 'x' from t_ctx $$,
  '42501', null, 'cannot link a board of another project');
select throws_ok(
  $$ insert into project_messages (org_id, project_id, body, attachment_ids)
     select org_a, '00000000-0000-0000-0000-0000000000f1', 'x', array['00000000-0000-0000-0000-0000000f0003'::uuid] from t_ctx $$,
  '42501', null, 'cannot attach a file of another project');
select is((select org_id from project_messages where id = '00000000-0000-0000-0000-0000000ee001'),
  (select org_a from t_ctx), 'message org comes from the project');
select ok(not collab_path_ok((select org_a from t_ctx)::text || '/00000000-0000-0000-0000-0000000000f1/shared/a.png', true),
  'a guest may not upload project files');
select ok(collab_path_ok((select org_a from t_ctx)::text || '/00000000-0000-0000-0000-0000000000f1/shared/a.png', false),
  'a guest may read project files');
select ok(realtime_project_topic_ok('project:00000000-0000-0000-0000-0000000000f1'),
  'a guest may receive on the project topic');
reset role;

-- ---- contributor C2 -----------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');

delete from board_files where id = '00000000-0000-0000-0000-0000000f0001';
select ok(exists (select 1 from board_files where id = '00000000-0000-0000-0000-0000000f0001'),
  'a contributor cannot delete someone else''s file');
delete from board_files where id = '00000000-0000-0000-0000-0000000f0002';
select ok(not exists (select 1 from board_files where id = '00000000-0000-0000-0000-0000000f0002'),
  'the uploader deletes own file');
delete from board_comments where id = '00000000-0000-0000-0000-0000000cc001';
select ok(exists (select 1 from board_comments where id = '00000000-0000-0000-0000-0000000cc001'),
  'a contributor cannot delete someone else''s comment');
update project_messages set body = 'αλλαγμένο' where id = '00000000-0000-0000-0000-0000000ee001';
delete from project_messages where id = '00000000-0000-0000-0000-0000000ee001';
select is((select body from project_messages where id = '00000000-0000-0000-0000-0000000ee001'), 'Καλημέρα!',
  'a contributor can neither edit nor delete someone else''s message');
select throws_ok(
  $$ update boards set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b003' $$,
  '42501', null, 'a contributor cannot trash a board created by staff');
select ok(not collab_path_manage_ok((select org_a from t_ctx)::text || '/00000000-0000-0000-0000-0000000000f1/shared/x.png'),
  'a contributor does not manage others'' objects');

select lives_ok(
  $$ insert into board_files (id, board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes)
     select '00000000-0000-0000-0000-0000000f0004', null, org_a, '00000000-0000-0000-0000-0000000000f1', 'pf',
            org_a::text || '/00000000-0000-0000-0000-0000000000f1/shared/pf.pdf', 'application/pdf', 10 from t_ctx $$,
  'a contributor uploads a project-level file');
select throws_ok(
  $$ insert into board_files (board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes)
     select null, org_a, '00000000-0000-0000-0000-0000000000f1', 'pf2',
            org_a::text || '/00000000-0000-0000-0000-0000000000f2/shared/pf2.pdf', 'application/pdf', 10 from t_ctx $$,
  '42501', null, 'a project file must sit in its own project''s shared folder');
select throws_ok(
  $$ insert into board_files (board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes)
     select null, org_a, '00000000-0000-0000-0000-0000000000f2', 'pf3',
            org_a::text || '/00000000-0000-0000-0000-0000000000f2/shared/pf3.pdf', 'application/pdf', 10 from t_ctx $$,
  '42501', null, 'cannot add a file to a project one is not on');
select ok(collab_path_ok((select org_a from t_ctx)::text || '/00000000-0000-0000-0000-0000000000f1/shared/a.png', true),
  'a contributor may upload project files');
select throws_ok(
  $$ insert into board_files (board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes, derived_from)
     select '00000000-0000-0000-0000-00000000b003', org_a, '00000000-0000-0000-0000-0000000000f1', 'pg1',
            org_a::text || '/00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000b003/pg1.jpg',
            'image/jpeg', 10, '00000000-0000-0000-0000-0000000f0003' from t_ctx $$,
  '42501', null, 'a PDF page cannot claim to come from another project''s file');
select lives_ok(
  $$ insert into board_files (id, board_id, org_id, project_id, file_id, storage_path, mime_type, size_bytes, derived_from)
     select '00000000-0000-0000-0000-0000000f0005', '00000000-0000-0000-0000-00000000b003', org_a,
            '00000000-0000-0000-0000-0000000000f1', 'pg2',
            org_a::text || '/00000000-0000-0000-0000-0000000000f1/00000000-0000-0000-0000-00000000b003/pg2.jpg',
            'image/jpeg', 10, '00000000-0000-0000-0000-0000000f0004' from t_ctx $$,
  'a PDF page records the PDF it was rendered from');

select lives_ok(
  $$ insert into project_messages (id, org_id, project_id, body, attachment_ids, board_id)
     select '00000000-0000-0000-0000-0000000ee003', org_a, '00000000-0000-0000-0000-0000000000f1', 'Η κάτοψη',
            array['00000000-0000-0000-0000-0000000f0004'::uuid], '00000000-0000-0000-0000-00000000b003' from t_ctx $$,
  'a message can carry a project file and a board link');
update project_messages set body = 'Η νέα κάτοψη' where id = '00000000-0000-0000-0000-0000000ee003';
select ok((select body = 'Η νέα κάτοψη' and edited_at is not null from project_messages
           where id = '00000000-0000-0000-0000-0000000ee003'),
  'the author edits own message and edited_at is stamped');
select throws_ok(
  $$ update project_messages set attachment_ids = '{}' where id = '00000000-0000-0000-0000-0000000ee003' $$,
  '42501', null, 'only the text of a message can change');
reset role;

-- ---- lead L -------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c0');

select lives_ok(
  $$ update boards set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b002' $$,
  'a lead trashes a contributor''s board');
select lives_ok(
  $$ update boards set deleted_at = null where id = '00000000-0000-0000-0000-00000000b002' $$,
  'a lead restores it');
update boards set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b005';
delete from boards where id = '00000000-0000-0000-0000-00000000b005';
select ok(not exists (select 1 from boards where id = '00000000-0000-0000-0000-00000000b005'),
  'a lead deletes a trashed board for good');
delete from boards where id = '00000000-0000-0000-0000-00000000b002';
select ok(exists (select 1 from boards where id = '00000000-0000-0000-0000-00000000b002'),
  'a lead cannot skip the trash');

delete from board_comments where id = '00000000-0000-0000-0000-0000000cc001';
select ok(not exists (select 1 from board_comments where id = '00000000-0000-0000-0000-0000000cc001'),
  'a lead deletes someone else''s comment');
delete from board_files where id = '00000000-0000-0000-0000-0000000f0001';
select ok(not exists (select 1 from board_files where id = '00000000-0000-0000-0000-0000000f0001'),
  'a lead deletes someone else''s file');
delete from board_files where id = '00000000-0000-0000-0000-0000000f0004';
select ok(not exists (select 1 from board_files where id = '00000000-0000-0000-0000-0000000f0005'),
  'deleting a PDF removes the page images rendered from it');
delete from collab_ai_threads where id = '00000000-0000-0000-0000-0000000aa001';
select ok(not exists (select 1 from collab_ai_threads where id = '00000000-0000-0000-0000-0000000aa001'),
  'a lead deletes someone else''s assistant thread');
delete from project_messages where id = '00000000-0000-0000-0000-0000000ee001';
select ok(not exists (select 1 from project_messages where id = '00000000-0000-0000-0000-0000000ee001'),
  'a lead deletes someone else''s message');
update project_messages set body = 'του lead' where id = '00000000-0000-0000-0000-0000000ee003';
select is((select body from project_messages where id = '00000000-0000-0000-0000-0000000ee003'), 'Η νέα κάτοψη',
  'not even a lead edits someone else''s message');
select ok(collab_path_manage_ok((select org_a from t_ctx)::text || '/00000000-0000-0000-0000-0000000000f1/shared/x.png'),
  'a lead manages the project''s objects');
select ok(not collab_path_manage_ok((select org_a from t_ctx)::text || '/00000000-0000-0000-0000-0000000000f2/shared/p2.pdf'),
  'a lead manages nothing in another project');
select ok(not can_manage_collab('00000000-0000-0000-0000-0000000000f2'), 'a lead of P1 does not manage P2');
reset role;

-- ---- org editor (owner A) -----------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

select ok(can_manage_collab('00000000-0000-0000-0000-0000000000f2'), 'an org editor manages every project');
select lives_ok(
  $$ update boards set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b0c1' $$,
  'an org editor trashes a partner''s board');
delete from board_comments where id = '00000000-0000-0000-0000-0000000cc002';
select ok(not exists (select 1 from board_comments where id = '00000000-0000-0000-0000-0000000cc002'),
  'an org editor deletes any comment');
delete from boards where id = '00000000-0000-0000-0000-00000000b004';
select ok(not exists (select 1 from boards where id = '00000000-0000-0000-0000-00000000b004'),
  'an org editor may still delete a live board outright');
reset role;

-- ---- outsider (another org) ---------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is((select count(*) from project_messages)::int, 0, 'an outsider sees no messages');
select ok(not realtime_project_topic_ok('project:00000000-0000-0000-0000-0000000000f1'),
  'an outsider cannot join the project topic');
update boards set deleted_at = null where id = '00000000-0000-0000-0000-00000000b0c1';
reset role;
select ok((select deleted_at is not null from boards where id = '00000000-0000-0000-0000-00000000b0c1'),
  'an outsider cannot restore a board');

select * from finish();
rollback;
