-- Budget lines (0069): spend lands on the line its category names, capex
-- without a line is «other», the contingency row absorbs the overruns, and
-- nobody outside the org sees a row.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000069a1', 'owner69@test.local'),
  ('00000000-0000-0000-0000-0000000069b1', 'other69@test.local');
create temp table t_ctx as
  select org_id as org_a from org_members where user_id = '00000000-0000-0000-0000-0000000069a1';
grant select on t_ctx to authenticated;

insert into projects (id, org_id, code, display_name, business_model)
select '00000000-0000-0000-0000-0000000069f1', org_a, 'B69', 'Έργο', 'own_development' from t_ctx;
insert into project_invites (project_id, email, role)
values ('00000000-0000-0000-0000-0000000069f1', 'partner69@test.local', 'contributor');
insert into auth.users (id, email, invited_at)
values ('00000000-0000-0000-0000-0000000069c1', 'partner69@test.local', now());

insert into project_budgets (id, org_id, project_id, contingency_pct)
select '00000000-0000-0000-0000-0000000069e1', org_a, '00000000-0000-0000-0000-0000000069f1', 0.10 from t_ctx;
insert into budget_lines (org_id, budget_id, line_code, amount)
select org_a, '00000000-0000-0000-0000-0000000069e1', v.code::budget_line_code, v.amount from t_ctx
cross join (values ('acquisition', 1000), ('construction_equipment', 2000)) v(code, amount);

insert into categories (org_id, code, name, cost_treatment, budget_line_code)
select org_a, 'T69_BUILD', 'Κατασκευή', 'capex', 'construction_equipment' from t_ctx;
insert into categories (org_id, code, name, cost_treatment)
select org_a, 'T69_MISC', 'Διάφορα', 'capex' from t_ctx;
insert into categories (org_id, code, name, cost_treatment)
select org_a, 'T69_OPEX', 'Λειτουργικά', 'opex' from t_ctx;

-- construction 2.300 paid (300 over), unlined capex 100 pending, opex never consumes
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, project_id, category_id)
select org_a, '2026-03-01', '2026-03-01', 'expense', 'paid', 2300, '00000000-0000-0000-0000-0000000069f1',
       (select id from categories where code = 'T69_BUILD') from t_ctx;
insert into transactions (org_id, tx_date, direction, status, gross_amount, project_id, category_id)
select org_a, '2026-03-01', 'expense', 'pending', 100, '00000000-0000-0000-0000-0000000069f1',
       (select id from categories where code = 'T69_MISC') from t_ctx;
insert into transactions (org_id, tx_date, paid_on, direction, status, gross_amount, project_id, category_id)
select org_a, '2026-03-01', '2026-03-01', 'expense', 'paid', 50, '00000000-0000-0000-0000-0000000069f1',
       (select id from categories where code = 'T69_OPEX') from t_ctx;

select pg_temp.as_user('00000000-0000-0000-0000-0000000069a1');
select is(
  (select array_agg(line_code || ':' || budget::int || '/' || paid::int || '/' || committed::int || '/' || remaining::int
                    order by line_code collate "C")
   from v_project_budget_lines),
  array['acquisition:1000/0/0/1000', 'construction_equipment:2000/2300/0/-300', 'contingency:300/0/400/-100',
        'other:0/0/100/-100'],
  'lines, «other» for unlined capex, contingency absorbing both overruns');
select is((select count(*)::int from v_project_budget_lines where line_code = 'contingency'), 1, 'one contingency row');
select is((select round(sum(paid))::int from v_project_budget_lines), 2300, 'opex never consumes the budget');
select is((select budget_line_code::text from categories where code = 'T69_BUILD'), 'construction_equipment',
  'the line is a property of the category');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000069c1');
select is((select count(*)::int from v_project_budget_lines), 0, 'a project partner sees 0 budget lines');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000069b1');
select is((select count(*)::int from v_project_budget_lines), 0, 'another org sees 0 budget lines of org A');
reset role;

select * from finish();
rollback;
