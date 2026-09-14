-- 0009: AADE myDATA import staging
-- Flow: upload -> parse -> stage -> review -> commit. Staging rows are never
-- deleted -- they are the audit trail and make "undo an import" possible.

create table aade_import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  filename text not null,
  file_sha256 text not null,
  period text,                       -- 'YYYY-MM'
  kind aade_kind,
  row_count int not null default 0,
  new_count int,
  dup_count int,
  status aade_batch_status not null default 'draft',
  storage_path text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (org_id, file_sha256)        -- the same file twice, caught before parsing
);

create table aade_staging_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  batch_id uuid not null references aade_import_batches(id) on delete cascade,
  row_no int not null,
  raw jsonb not null,                 -- every source column, verbatim, forever
  issue_date date,
  mydata_mark text,
  invoice_number text,
  document_type text,
  issuer_afm text,
  receiver_afm text,
  counterparty_afm text,
  counterparty_name text,
  kad_code text,
  kad_description text,
  net_amount numeric(14,2),
  gross_amount numeric(14,2),
  vat_amount numeric(14,2),
  withholding_amount numeric(14,2),
  digital_fee numeric(14,2),
  fees numeric(14,2),
  other_taxes numeric(14,2),
  deductions numeric(14,2),
  discrepancy text,
  direction tx_direction,             -- derived from own_afm comparison, not the sheet name
  fingerprint text,
  dedup_status aade_dedup_status not null default 'new',
  matched_transaction_id uuid references transactions(id),
  decision aade_decision not null default 'import',
  project_id uuid references projects(id),
  category_id uuid references categories(id),
  account_id uuid references accounts(id),
  status tx_status not null default 'paid',
  scope tx_scope not null default 'business',
  committed_transaction_id uuid references transactions(id),
  parse_errors text[],
  unique (batch_id, row_no)
);
create index aade_staging_rows_batch_dedup_idx on aade_staging_rows (batch_id, dedup_status);
create index aade_staging_rows_org_mark_idx on aade_staging_rows (org_id, mydata_mark);

-- Deferred from 0004: transactions.aade_staging_row_id can now reference this table.
alter table transactions
  add constraint transactions_aade_staging_row_id_fkey
  foreign key (aade_staging_row_id) references aade_staging_rows(id) on delete set null;

comment on table aade_staging_rows is
  'raw jsonb is non-negotiable: AADE changes its export columns periodically, '
  'so a future schema change becomes a backfill instead of a re-download. It '
  'also means the myDATA REST API (mydatapi.aade.gr) could later write these '
  'same rows directly, with zero schema change -- only the upload step is '
  'file-shaped.';

comment on column aade_staging_rows.dedup_status is
  'dup_self_classification is the myDATA quirk where, if the issuer''s '
  'transmission is missing or mismatched, myDATA emits a stand-in row with a '
  'blank counterparty AFM for the same invoice. The commit function keeps the '
  'correctly-attributed row and skips the blank one -- ported verbatim from '
  'aade_exports_master.py, which is the only place this behaviour is documented.';
