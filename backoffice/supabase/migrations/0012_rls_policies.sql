-- 0012: row-level security, role-aware from day one
--
-- Every org-scoped table gets the same shape: viewers can select, editors can
-- write. Everyone is seeded 'owner' (0002), so today everyone sees and edits
-- everything -- exactly as requested. Restricting a colleague later is
-- `update org_members set role='viewer'`, zero schema/policy changes needed.

do $$
declare
  t text;
  tables text[] := array[
    'projects','contacts','accounts','categories',
    'installment_plans','transactions','documents',
    'project_budgets','budget_lines','project_model_inputs','project_seasonality',
    'vat_periods','withholding_periods',
    'loans','loan_drawdowns','liabilities','assets','expected_income',
    'aade_import_batches','aade_staging_rows',
    'document_jobs','transaction_drafts','ai_corrections','ai_usage','attachments'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security', t);

    execute format(
      'create policy %I on %I for select using (has_role(org_id, ''viewer''))',
      t || '_select', t);

    execute format(
      'create policy %I on %I for insert with check (has_role(org_id, ''editor''))',
      t || '_insert', t);

    execute format(
      'create policy %I on %I for update using (has_role(org_id, ''editor'')) with check (has_role(org_id, ''editor''))',
      t || '_update', t);

    execute format(
      'create policy %I on %I for delete using (has_role(org_id, ''editor''))',
      t || '_delete', t);
  end loop;
end $$;

-- Views inherit RLS from their underlying tables automatically in Postgres —
-- no separate policies needed for v_* views.

comment on function has_role is
  'Column-free "scope gate" note: scope (business/personal on transactions) '
  'and accounts.owner_scope (corporate/personal) are independent dimensions, '
  'as in the workbook -- never collapse them. A future "hide personal from '
  'colleagues" split is one extra clause on the transactions_select policy: '
  'and (scope=''business'' or has_role(org_id,''admin'')).';
