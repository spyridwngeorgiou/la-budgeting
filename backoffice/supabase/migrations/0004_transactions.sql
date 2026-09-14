-- 0004: the ledger core
-- Amounts are ALWAYS POSITIVE; direction carries the sign (matches the
-- workbook's own QC invariant). All rates are fractions (0.24, never 24).

-- Defined here (rather than in 0005) because transactions.plan_id needs the FK.
-- regenerate_plan(), ensure_plans_current() and the completion trigger are in 0005.
create table installment_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  label text not null,
  direction tx_direction not null,
  scope tx_scope not null default 'business',
  contact_id uuid references contacts(id),
  project_id uuid references projects(id),
  category_id uuid references categories(id),
  account_id uuid references accounts(id),
  amount_per_installment numeric(14,2) not null check (amount_per_installment > 0),
  vat_rate numeric(6,4),
  vat_per_installment numeric(14,2) not null default 0,
  withholding_per_installment numeric(14,2) not null default 0,
  escalation_pct numeric(6,4) not null default 0,   -- e.g. the 23-year lease's 3.5%/yr
  frequency plan_frequency not null default 'monthly',
  first_due_date date not null,
  installment_count int check (installment_count > 0),   -- null = indefinite
  end_date date,
  horizon_months int not null default 24,
  status plan_status not null default 'active',
  generated_through date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger installment_plans_set_updated_at before update on installment_plans
  for each row execute function set_updated_at();

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  storage_path text not null,          -- {org}/{yyyy}/{mm}/{uuid}.jpg
  mime_type text,
  byte_size int,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- dates
  tx_date  date not null,             -- invoice/issue date: the accrual anchor for VAT & budgets
  due_date date,                      -- Ημ/νία Λήξης
  paid_on  date,                      -- when cash actually moved

  -- parties
  contact_id uuid references contacts(id) on delete set null,
  counterparty_afm  text,             -- denormalised on purpose, see README note below
  counterparty_name text,             -- as printed on the invoice

  -- classification
  project_id  uuid references projects(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  account_id  uuid references accounts(id) on delete set null,
  direction tx_direction not null,
  scope     tx_scope not null default 'business',
  status    tx_status not null default 'pending',
  origin    tx_origin not null default 'manual',

  -- money (always positive)
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  net_amount   numeric(14,2) check (net_amount >= 0),
  vat_amount   numeric(14,2) not null default 0 check (vat_amount >= 0),
  vat_rate     numeric(6,4) check (vat_rate between 0 and 1),
  withholding_amount numeric(14,2) not null default 0 check (withholding_amount >= 0),
  other_taxes  numeric(14,2) not null default 0,   -- ΤΕΛΗ / ΑΛΛΟΙ ΦΟΡΟΙ / ΨΗΦΙΑΚΟ ΤΕΛΟΣ from myDATA
  currency char(3) not null default 'EUR',

  -- documents & provenance
  invoice_number text,                -- ΑΡ. ΠΑΡΑΣΤΑΤΙΚΟΥ, e.g. 'ΤΔΑ/129'
  mydata_mark    text,                -- ΜΑΡΚ, e.g. '400008883252876'
  document_type  text,                -- 'Τιμολόγιο Παροχής Υπηρεσιών'
  has_invoice    boolean not null default false,   -- books vs pure cash
  aade_discrepancy text,              -- Παράλειψη/Απόκλιση
  aade_staging_row_id uuid,   -- FK to aade_staging_rows added in 0009 once that table exists
  source_document_id  uuid references documents(id) on delete set null,
  ai_confidence jsonb,

  description text,
  notes text,

  -- forecasting
  collection_probability numeric(6,4) check (collection_probability between 0 and 1),
                                       -- null = 100%, matching the workbook's "blank means certain"

  -- installments
  plan_id uuid references installment_plans(id) on delete cascade,
  installment_no int check (installment_no >= 1),

  -- audit
  legacy_excel_id text,                -- verbatim Μοναδικό ID from the workbook
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- generated
  signed_amount numeric(14,2) generated always as
    (case when direction = 'income' then gross_amount else -gross_amount end) stored,
  -- to_char() is STABLE (locale/timezone-dependent), not IMMUTABLE, so it
  -- cannot appear in a generated column -- Postgres rejects the table
  -- definition outright. extract() and numeric::text are immutable.
  month_key text generated always as (
      lpad(extract(year from tx_date)::text, 4, '0') || '-' ||
      lpad(extract(month from tx_date)::text, 2, '0')
  ) stored,
  fingerprint text generated always as (
      (tx_date - date '1899-12-30')::text || '-' ||
      coalesce(counterparty_afm,'')       || '-' ||
      gross_amount::text || '-' ||
      coalesce(mydata_mark,'')
  ) stored,

  constraint tx_plan_consistency check ((plan_id is null) = (installment_no is null)),
  constraint tx_cash_has_no_vat  check (has_invoice or (vat_amount = 0 and withholding_amount = 0)),
  constraint tx_paid_needs_date  check (status <> 'paid' or paid_on is not null or origin = 'aade')
);

create index transactions_org_date_idx on transactions (org_id, tx_date desc);
create index transactions_org_project_date_idx on transactions (org_id, project_id, tx_date);
create index transactions_org_contact_idx on transactions (org_id, contact_id);
create index transactions_org_account_paid_idx on transactions (org_id, account_id) where status = 'paid';
create index transactions_org_open_status_idx on transactions (org_id, status, due_date)
  where status in ('pending','scheduled');
create index transactions_org_month_business_idx on transactions (org_id, month_key) where scope = 'business';
create index transactions_plan_installment_idx on transactions (plan_id, installment_no);

create unique index tx_mark_uq on transactions (org_id, mydata_mark)
  where mydata_mark is not null and mydata_mark <> '';
create unique index tx_fingerprint_uq on transactions (org_id, fingerprint)
  where origin = 'aade';
create unique index tx_plan_no_uq on transactions (plan_id, installment_no)
  where plan_id is not null;

create trigger transactions_set_updated_at before update on transactions
  for each row execute function set_updated_at();

comment on column transactions.counterparty_afm is
  'Denormalised deliberately: a generated column cannot join to contacts, AADE '
  'supplies an AFM even with no contact record yet (the workbook''s VLOOKUP '
  'yields "" there — a live dedup hole), and the AFM printed on an old invoice '
  'must not change retroactively when a contact record is edited later. '
  'v_qc_afm_mismatch flags disagreement with the linked contact.';

comment on column transactions.fingerprint is
  'Recomputed (period-decimal, locale-proof), not copied from the workbook''s '
  'comma-decimal Μοναδικό ID string — same meaning, safe to index. The verbatim '
  'legacy string is kept in legacy_excel_id for audit.';
