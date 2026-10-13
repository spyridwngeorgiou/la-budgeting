-- accounts.account_number (0094): digits only, optional; the Piraeus XLSX
-- preset is seeded once, readable as a built-in (org_id null) profile.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

select has_column('public', 'accounts', 'account_number', 'accounts has account_number');
select col_is_null('public', 'accounts', 'account_number', 'account_number is optional');

-- handle_new_user() gives the user an org of its own.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000094a0', 'a94@test.local');
create temp table t_org as
  select org_id from org_members where user_id = '00000000-0000-0000-0000-0000000094a0';

select lives_ok(
  $$ insert into accounts (org_id, name, owner_scope, opening_balance_date, account_number)
     select org_id, 'Synthetic', 'corporate', '2026-01-01', '12345678901234' from t_org $$,
  'a digits-only account number is accepted'
);
select throws_ok(
  $$ insert into accounts (org_id, name, owner_scope, opening_balance_date, account_number)
     select org_id, 'Bad', 'corporate', '2026-01-01', '1234 5678-90' from t_org $$,
  '23514', null,
  'spaces and dashes are rejected (store digits only)'
);
select lives_ok(
  $$ insert into accounts (org_id, name, owner_scope, opening_balance_date)
     select org_id, 'No number', 'corporate', '2026-01-01' from t_org $$,
  'an account without a number is fine'
);

select is(
  (select count(*)::int from bank_import_profiles where org_id is null and name = 'Πειραιώς (XLSX, e-banking)'),
  1,
  'the Piraeus XLSX preset is seeded once'
);
select is(
  (select column_map -> 'description' -> 'join' ->> 1 from bank_import_profiles where org_id is null and name = 'Πειραιώς (XLSX, e-banking)'),
  'ΣΧΟΛΙΑ / ΚΩΔΙΚΟΣ ΑΝΑΦΟΡΑΣ',
  'its description joins the comments column'
);

select * from finish();
rollback;
