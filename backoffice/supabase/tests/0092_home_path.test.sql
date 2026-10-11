-- profiles.home_path (0092): a user sets their own start page; another
-- user's row is untouched (RLS profiles_write); a path outside the allowed
-- list is rejected by the check constraint.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

-- handle_new_user() creates each profile row (and a separate org each, so
-- neither user can even see the other's profile).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000092a0', 'a92@test.local'),
  ('00000000-0000-0000-0000-0000000092b0', 'b92@test.local');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select is(
  array(select home_path from profiles where user_id = '00000000-0000-0000-0000-0000000092a0'),
  array[null::text],
  'a new profile has no home_path (the default, /dashboard)'
);

-- ---- own row -----------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000092a0');
select lives_ok(
  $$ update profiles set home_path = '/inbox' where user_id = '00000000-0000-0000-0000-0000000092a0' $$,
  'a user sets their own home_path'
);

-- ---- someone else's row: RLS filters it out, nothing changes -------------------
update profiles set home_path = '/accounts' where user_id = '00000000-0000-0000-0000-0000000092b0';
reset role;
select is(
  array(select home_path from profiles where user_id = '00000000-0000-0000-0000-0000000092b0'),
  array[null::text],
  'another user''s home_path cannot be set'
);
select is(
  array(select home_path from profiles where user_id = '00000000-0000-0000-0000-0000000092a0'),
  array['/inbox'::text],
  'the own row kept its new value'
);

-- ---- invalid path --------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000092a0');
select throws_ok(
  $$ update profiles set home_path = 'https://evil.example' where user_id = '00000000-0000-0000-0000-0000000092a0' $$,
  '23514', null,
  'a path outside the allowed list is rejected'
);
select lives_ok(
  $$ update profiles set home_path = null where user_id = '00000000-0000-0000-0000-0000000092a0' $$,
  'clearing back to the default is allowed'
);
reset role;
select is(
  array(select home_path from profiles where user_id = '00000000-0000-0000-0000-0000000092a0'),
  array[null::text],
  'cleared to null'
);

select * from finish();
rollback;
