-- 0029: Money Manager (cash) import. The phone sends the app's Excel export
-- to /api/import/money-manager; every row is staged here, matched against the
-- cash already in the ledger (same date ±1 day, same amount, same direction),
-- and only what is new waits for a decision on /money-manager:
--   personal  -> personal cash expense («Προσωπικά έξοδα»)
--   business  -> business cash payment of a chosen project
--   skip      -> not imported
-- Nothing reaches the ledger without that decision. Rows already in the
-- ledger are kept as 'exists' so a re-send of the same export changes nothing.

create table mm_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  filename text,
  storage_path text,
  file_sha256 text not null,
  period_from date,
  period_to date,
  row_count int not null default 0,
  new_count int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'applied')),
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (org_id, file_sha256)
);

create table mm_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  import_id uuid not null references mm_imports(id) on delete cascade,
  row_no int not null,
  tx_date date not null,
  account_label text,
  category text,
  subcategory text,
  note text,
  amount numeric(14,2) not null,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  match_status text not null check (match_status in ('new', 'exists', 'not_cash')),
  matched_transaction_id uuid references transactions(id) on delete set null,
  decision text check (decision in ('personal', 'business', 'skip')),
  project_id uuid references projects(id) on delete set null,
  committed_transaction_id uuid references transactions(id) on delete set null,
  raw jsonb not null default '{}',
  unique (import_id, row_no)
);
create index mm_rows_import_idx on mm_rows (import_id, match_status);

alter table mm_imports enable row level security;
alter table mm_rows enable row level security;
create policy mm_imports_select on mm_imports for select using (has_role(org_id, 'viewer'));
create policy mm_imports_write on mm_imports for all using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy mm_rows_select on mm_rows for select using (has_role(org_id, 'viewer'));
create policy mm_rows_write on mm_rows for all using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
