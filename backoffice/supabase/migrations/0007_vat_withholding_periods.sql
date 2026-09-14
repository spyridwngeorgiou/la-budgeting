-- 0007: VAT and withholding period tracking
-- Store only human facts (filing/payment); the arithmetic is a view
-- (v_vat_position, 0011) so it can never drift from the underlying ledger.

create table vat_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status filing_status not null default 'pending',
  filed_on date,
  amount_paid numeric(14,2),
  paid_on date,
  reference text,                       -- ΤΑΥΤΟΤΗΤΑ ΟΦΕΙΛΗΣ / e-filing ref
  notes text,
  -- Once filed, the figures are snapshotted so a later backdated transaction
  -- cannot silently change what was actually submitted to the tax office.
  locked boolean not null default false,
  locked_vat_income numeric(14,2),
  locked_vat_expense numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, period_start)
);
create trigger vat_periods_set_updated_at before update on vat_periods
  for each row execute function set_updated_at();

create table withholding_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status filing_status not null default 'pending',
  filed_on date,
  amount_paid numeric(14,2),
  paid_on date,
  reference text,
  notes text,
  locked boolean not null default false,
  locked_withholding numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, period_start)
);
create trigger withholding_periods_set_updated_at before update on withholding_periods
  for each row execute function set_updated_at();

comment on table vat_periods is
  'VAT is Greek 24% standard rate, computed on invoice date (accrual), with '
  'credit carrying forward month to month. See v_vat_position for the '
  'closed-form window-function equivalent of the workbook''s row-by-row '
  'recursion (credit_n = MIN(0, net_n + credit_{n-1})). Filing cadence '
  '(monthly for διπλογραφικά books, quarterly for απλογραφικά) is read from '
  'orgs.settings->>''vat_period'' -- confirm the regime with the accountant '
  'before go-live.';
