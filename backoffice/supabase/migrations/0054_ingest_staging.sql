-- 0054: one staging model for every way data comes in.
--
-- Flow: upload/parse -> ingest_batches + ingest_rows (staged) -> matcher
-- writes ingest_row_matches -> a human reviews decisions -> commit_ingest_batch
-- (0055) applies them atomically -> undo_ingest_batch can reverse it.
-- Generalises 0009's AADE-only staging; AADE, AI documents, email and NL
-- entries move onto these tables in later steps (0056 backfills).
--
-- Like aade_staging_rows, ingest rows are never deleted after commit: they
-- are the audit trail, and `applied` is exactly what undo needs.

create table ingest_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  source ingest_source not null,
  status ingest_batch_status not null default 'staged',
  -- The account a statement belongs to (bank_file / bank_pdf / psd2 / cash).
  account_id uuid references accounts(id) on delete set null,
  profile_id uuid references bank_import_profiles(id) on delete set null,
  filename text,
  file_sha256 text,
  storage_path text,
  mime_type text,
  -- As printed on the statement, for the opening + Σ = closing check.
  period_start date,
  period_end date,
  opening_balance numeric(14,2),
  closing_balance numeric(14,2),
  row_count int not null default 0,
  meta jsonb not null default '{}',
  -- Optimistic lock: bumped by every staged edit (trigger on ingest_rows
  -- below) and by commit/undo. commit_ingest_batch refuses a stale version,
  -- so two people reviewing the same statement cannot commit over each other.
  version int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz,
  committed_by uuid references auth.users(id),
  undone_at timestamptz,
  undone_by uuid references auth.users(id)
);
-- The same file twice is caught before parsing -- unless the earlier batch
-- was discarded or undone, in which case re-uploading it is the fix.
create unique index ingest_batches_file_uq on ingest_batches (org_id, file_sha256)
  where file_sha256 is not null and status in ('staged', 'committed');
create index ingest_batches_org_created_idx on ingest_batches (org_id, created_at desc);
create trigger ingest_batches_set_updated_at before update on ingest_batches
  for each row execute function set_updated_at();

create table ingest_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  batch_id uuid not null references ingest_batches(id) on delete cascade,
  row_no int not null,                 -- line/row number in the source file
  row_kind ingest_row_kind not null,
  raw jsonb not null,                  -- every source cell, verbatim, forever
  extracted jsonb not null default '{}', -- what the parser found: AFMs, IBANs, RF, ΜΑΡΚ in the text
  meta jsonb not null default '{}',
  -- Identity of the line across files: a bank-line fingerprint
  -- (src/lib/ingest/fingerprint.ts), a ΜΑΡΚ, a draft id. Unique among
  -- committed rows (index below), so an overlapping statement can never
  -- book the same movement twice.
  external_key text,

  -- canonical fields, whatever the source
  tx_date date,
  value_date date,
  direction tx_direction,
  amount numeric(14,2) check (amount >= 0),   -- gross, always positive (0004 rule)
  net_amount numeric(14,2) check (net_amount >= 0),
  vat_amount numeric(14,2) check (vat_amount >= 0),
  vat_rate numeric(6,4) check (vat_rate between 0 and 1),
  withholding_amount numeric(14,2) check (withholding_amount >= 0),
  description text,
  counterparty_name text,
  counterparty_afm text,
  counterparty_iban text,
  reference text,                      -- bank transaction reference / RF code
  invoice_number text,
  mydata_mark text,
  balance_after numeric(14,2),         -- running balance printed on the line
  status tx_status,                    -- null: movement -> paid, document -> pending
  paid_on date,                        -- null: value_date, else tx_date

  -- assignment (editable while staged)
  account_id uuid references accounts(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  scope tx_scope not null default 'business',

  dedup_status ingest_dedup_status not null default 'new',
  decision ingest_decision not null default 'pending',
  -- Existing transaction(s) a settle / settle_partial / settle_many /
  -- link_existing decision points at. Validated (same org, right state) by
  -- commit_ingest_batch, not by an FK -- arrays cannot carry one.
  decision_targets uuid[] not null default '{}',
  parse_errors text[] not null default '{}',

  -- Written by commit, cleared by undo: what was created/changed and the
  -- before-image of every changed field. See 0055.
  applied jsonb,
  committed_at timestamptz,
  committed_transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_no),
  constraint ingest_rows_targets_match_decision check (
    case decision
      when 'settle' then cardinality(decision_targets) = 1
      when 'settle_partial' then cardinality(decision_targets) = 1
      when 'link_existing' then cardinality(decision_targets) = 1
      when 'settle_many' then cardinality(decision_targets) between 2 and 20
      else true
    end
  )
);
create unique index ingest_rows_external_key_uq on ingest_rows (org_id, external_key)
  where external_key is not null and committed_at is not null;
create index ingest_rows_batch_idx on ingest_rows (batch_id, row_no);
create index ingest_rows_org_key_idx on ingest_rows (org_id, external_key) where external_key is not null;
create trigger ingest_rows_set_updated_at before update on ingest_rows
  for each row execute function set_updated_at();

-- Matcher output (src/lib/ingest/match): ranked candidates per row with the
-- reasons behind each score, so the review panel can show "why".
create table ingest_row_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  row_id uuid not null references ingest_rows(id) on delete cascade,
  rank int not null,
  kind text not null check (kind in ('single', 'partial', 'many', 'already_recorded')),
  transaction_ids uuid[] not null check (cardinality(transaction_ids) >= 1),
  score int not null,
  reasons jsonb not null default '[]',   -- [{code, points, detail}]
  created_at timestamptz not null default now(),
  unique (row_id, rank)
);

-- Any edit to staged rows bumps the batch version (see ingest_batches.version).
-- Skipped while commit/undo themselves rewrite the rows -- they bump it once.
create function public.ingest_rows_bump_batch_version() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if nullif(current_setting('app.ingest_batch_id', true), '') is not null then
    return null;
  end if;
  update ingest_batches b set version = b.version + 1
  where b.id in (select distinct n.batch_id from changed_rows n)
    and b.status in ('staged', 'undone');
  return null;
end;
$$;
create trigger ingest_rows_bump_version
  after update on ingest_rows
  referencing new table as changed_rows
  for each statement execute function ingest_rows_bump_batch_version();

-- The ledger side of the link.
alter table transactions add column ingest_row_id uuid references ingest_rows(id) on delete set null;
alter table transactions add column bank_reference text;
create index transactions_ingest_row_idx on transactions (ingest_row_id) where ingest_row_id is not null;

comment on column transactions.ingest_row_id is
  'The ingest row that created or settled this transaction (latest one wins; '
  'the full chain is in transaction_history).';
comment on column transactions.bank_reference is
  'Bank transaction reference / RF code of the movement that paid it.';

alter table transaction_history
  add constraint transaction_history_ingest_batch_id_fkey
  foreign key (ingest_batch_id) references ingest_batches(id) on delete set null;

do $$
declare
  t text;
begin
  foreach t in array array['ingest_batches', 'ingest_rows', 'ingest_row_matches'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (has_role(org_id, ''viewer''))', t || '_select', t);
    execute format('create policy %I on %I for insert with check (has_role(org_id, ''editor''))', t || '_insert', t);
    execute format('create policy %I on %I for update using (has_role(org_id, ''editor'')) with check (has_role(org_id, ''editor''))', t || '_update', t);
    execute format('create policy %I on %I for delete using (has_role(org_id, ''editor''))', t || '_delete', t);
  end loop;
end $$;

-- Uploaded statements. Same "<org_id>/..." path layout as aade-imports
-- (0015) and documents (0017), but gated by role rather than bare
-- membership: viewers may download, only editors may upload. CASE (not AND)
-- so the uuid cast is never attempted on another bucket's object names.
insert into storage.buckets (id, name, public)
values ('bank-statements', 'bank-statements', false)
on conflict (id) do nothing;

create policy bank_statements_select on storage.objects for select
  using (case when bucket_id = 'bank-statements'
               then has_role((storage.foldername(name))[1]::uuid, 'viewer') else false end);

create policy bank_statements_insert on storage.objects for insert
  with check (case when bucket_id = 'bank-statements'
                    then has_role((storage.foldername(name))[1]::uuid, 'editor') else false end);
