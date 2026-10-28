-- 0032: live bank feed through Enable Banking (PSD2, read-only).
--
--   bank_connections  one consent per bank (180 days), from /bank
--   bank_links        each bank account of a connection -> our accounts row
--   bank_tx           every transaction the bank returned, once (unique per
--                     link + bank reference), with what we did with it:
--                       matched   = already in the ledger (same account and
--                                   amount, date close) -- linked, not added
--                       paid      = an open (pending/scheduled) ledger row was
--                                   marked paid by it
--                       added     = a new paid ledger row was created
--                       pending   = the bank still shows it pending; recorded
--                                   when it is booked
--   bank_sync_runs    one row per run: counts, bank vs ledger balance.
--
-- The ledger stays the single truth; bank_tx is the audit trail of the feed.

create table bank_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  aspsp_name text not null,
  aspsp_country text not null default 'GR',
  psu_type text not null default 'personal' check (psu_type in ('personal', 'business')),
  auth_state text,
  session_id text,
  valid_until timestamptz,
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'revoked', 'failed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bank_connections_state_uq on bank_connections (auth_state) where auth_state is not null;

create table bank_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  connection_id uuid not null references bank_connections(id) on delete cascade,
  account_uid text not null,            -- Enable Banking account uid (per session)
  iban text,
  bank_account_no text,
  name text,
  currency text,
  account_id uuid references accounts(id) on delete set null,   -- our ledger account
  sync_from date,                       -- first booking date to import
  last_synced_at timestamptz,
  last_bank_balance numeric(14,2),
  last_bank_balance_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (connection_id, account_uid)
);

create table bank_tx (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  link_id uuid not null references bank_links(id) on delete cascade,
  ref text not null,                    -- entry_reference / transaction_id / hash
  booking_date date,
  value_date date,
  amount numeric(14,2) not null,        -- positive
  direction tx_direction not null,
  currency text,
  bank_status text,                     -- BOOK / PDNG
  description text,
  counterparty text,
  raw jsonb not null default '{}',
  outcome text not null default 'new' check (outcome in ('new', 'matched', 'paid', 'added', 'pending', 'ignored')),
  transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (link_id, ref)
);
create index bank_tx_outcome_idx on bank_tx (org_id, outcome, booking_date desc);

create table bank_sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched int not null default 0,
  matched int not null default 0,
  paid int not null default 0,
  added int not null default 0,
  pending int not null default 0,
  balances jsonb not null default '[]',  -- [{account, bank, ledger, diff}]
  error text
);

create trigger bank_connections_set_updated_at before update on bank_connections for each row execute function set_updated_at();
create trigger bank_tx_set_updated_at before update on bank_tx for each row execute function set_updated_at();

alter table bank_connections enable row level security;
alter table bank_links enable row level security;
alter table bank_tx enable row level security;
alter table bank_sync_runs enable row level security;
create policy bank_connections_select on bank_connections for select using (has_role(org_id, 'viewer'));
create policy bank_connections_write on bank_connections for all using (has_role(org_id, 'admin')) with check (has_role(org_id, 'admin'));
create policy bank_links_select on bank_links for select using (has_role(org_id, 'viewer'));
create policy bank_links_write on bank_links for all using (has_role(org_id, 'admin')) with check (has_role(org_id, 'admin'));
create policy bank_tx_select on bank_tx for select using (has_role(org_id, 'viewer'));
create policy bank_tx_write on bank_tx for all using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy bank_sync_runs_select on bank_sync_runs for select using (has_role(org_id, 'viewer'));
