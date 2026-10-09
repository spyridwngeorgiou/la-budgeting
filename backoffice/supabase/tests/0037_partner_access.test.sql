-- External partners (0037): invite -> signup creates a project membership
-- and no org; a partner reads nothing outside the collaboration allowlist.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Owner A (gets their own org through handle_new_user, as before).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.local');

create temp table t_ctx as
  select org_id as org_a from org_members where user_id = '00000000-0000-0000-0000-0000000000a1';
grant select on t_ctx to authenticated;

insert into projects (id, org_id, code, display_name, contract_value)
select '00000000-0000-0000-0000-0000000000f1', org_a, 'P1', 'Έργο 1', 500000 from t_ctx;
insert into projects (id, org_id, code, display_name)
select '00000000-0000-0000-0000-0000000000f2', org_a, 'P2', 'Έργο 2' from t_ctx;

-- Something worth leaking in org A, so "partner sees 0 rows" means something.
insert into accounts (org_id, name, owner_scope, opening_balance, opening_balance_date)
select org_a, 'Τράπεζα', 'corporate', 1000, '2026-01-01' from t_ctx;
insert into contacts (org_id, name) select org_a, 'Προμηθευτής' from t_ctx;
insert into project_notes (org_id, project_id, body)
select org_a, '00000000-0000-0000-0000-0000000000f1', 'Εσωτερική σημείωση' from t_ctx;
insert into storage.objects (bucket_id, name)
select 'documents', org_a::text || '/receipt.jpg' from t_ctx;
insert into storage.objects (bucket_id, name)
select 'aade-imports', org_a::text || '/export.csv' from t_ctx;

-- Invites written by an admin (org_id is filled in by trigger).
insert into project_invites (project_id, email, full_name, company_name, role, discipline) values
  ('00000000-0000-0000-0000-0000000000f1', 'partner@test.local', 'Μαρία Αρχιτέκτων', 'Studio M', 'contributor', 'architect'),
  ('00000000-0000-0000-0000-0000000000f1', 'claimer@test.local', null, null, 'lead', null);

create temp table t_org_count as select count(*) as n from orgs;
grant select on t_org_count to authenticated;

-- Partner arrives through inviteUserByEmail (invited_at set).
insert into auth.users (id, email, invited_at)
values ('00000000-0000-0000-0000-0000000000b1', 'Partner@Test.local', now());

select is((select count(*) from org_members where user_id = '00000000-0000-0000-0000-0000000000b1')::int, 0,
  'invited partner gets no org membership');
select is((select count(*) from orgs)::int, (select n from t_org_count)::int,
  'invited partner signup creates no org');
select is((select role::text from project_members
           where user_id = '00000000-0000-0000-0000-0000000000b1'
             and project_id = '00000000-0000-0000-0000-0000000000f1'),
  'contributor', 'invite became a project membership with the invited role');
select is((select org_id from project_members where user_id = '00000000-0000-0000-0000-0000000000b1'),
  (select org_a from t_ctx), 'membership org_id comes from the project');
select isnt((select accepted_at from project_invites where email = 'partner@test.local'), null,
  'invite is marked accepted');
select is((select display_name || ' / ' || company_name from profiles where user_id = '00000000-0000-0000-0000-0000000000b1'),
  'Μαρία Αρχιτέκτων / Studio M', 'profile seeded from the admin-entered invite');

-- A self-service signup merely claiming an invited address (no invite, no
-- confirmed email) must not be granted the project.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'claimer@test.local');
select is((select count(*) from project_members where user_id = '00000000-0000-0000-0000-0000000000c1')::int, 0,
  'unconfirmed signup does not consume an invite');
select is((select count(*) from org_members where user_id = '00000000-0000-0000-0000-0000000000c1')::int, 1,
  'unconfirmed signup keeps the old own-org behaviour');

-- ---- as the partner -------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');

select ok(not is_internal_user(), 'partner is not internal');
select ok(can_access_project('00000000-0000-0000-0000-0000000000f1'), 'partner can access invited project');
select ok(not can_access_project('00000000-0000-0000-0000-0000000000f2'), 'partner cannot access other project');
select ok(can_edit_collab('00000000-0000-0000-0000-0000000000f1'), 'contributor can edit collab');
select is((select count(*) from my_collab_projects())::int, 1, 'my_collab_projects lists only the invited project');
select is((select count(*) from collab_people('00000000-0000-0000-0000-0000000000f1'))::int, 2,
  'collab_people lists partner + internal owner');
select is((select count(*) from collab_people('00000000-0000-0000-0000-0000000000f2'))::int, 0,
  'collab_people is empty for an inaccessible project');

-- Every public table and view outside the collaboration allowlist is empty
-- for a partner. Loops over information_schema so a new table can't slip in
-- unreviewed.
create temp table t_leaks (relname text, n bigint);
grant insert, select on t_leaks to authenticated;
do $$
declare
  r record;
  v_n bigint;
begin
  for r in
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name not in (
        'boards', 'board_elements', 'board_files', 'board_comments', 'project_activity',
        'project_members', 'profiles',
        'collab_ai_threads', 'collab_ai_messages', 'collab_ai_proposals',
        'project_messages'
      )
  loop
    begin
      execute format('select count(*) from public.%I', r.table_name) into v_n;
    exception when insufficient_privilege then
      v_n := 0;
    end;
    if v_n > 0 then
      insert into t_leaks values (r.table_name, v_n);
    end if;
  end loop;
end $$;
select is_empty('select relname from t_leaks', 'partner sees 0 rows in every non-collab public table/view');

select is((select count(*) from profiles)::int, 1, 'partner sees only their own profile');
select is((select count(*) from storage.objects where bucket_id in ('documents', 'aade-imports'))::int, 0,
  'partner cannot list documents / aade-imports objects');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     select 'documents', org_a::text || '/sneaky.jpg' from t_ctx $$,
  '42501', null, 'partner cannot upload into documents');
select throws_ok(
  $$ insert into project_members (project_id, user_id, role)
     values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', 'lead') $$,
  '42501', null, 'partner cannot add themselves to another project');

update project_members set role = 'lead' where user_id = '00000000-0000-0000-0000-0000000000b1';
reset role;
select is((select role::text from project_members where user_id = '00000000-0000-0000-0000-0000000000b1'),
  'contributor', 'partner cannot promote themselves');

-- ---- as the internal owner ------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from profiles where user_id = '00000000-0000-0000-0000-0000000000b1')::int, 1,
  'internal staff can see their project partners'' profiles');
reset role;

select * from finish();
rollback;
