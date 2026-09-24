-- 0023: monthly balance assertion.
--
-- Full bank-statement reconciliation (import + matching) is a large,
-- deliberately deferred build for ~200 transactions/2 users. This gets most
-- of the trust benefit at a fraction of the cost: once a month, per
-- account, type in the real closing balance from the banking app; the app
-- shows the drift against what it computed. Thirty seconds of input.
--
-- computed_balance is stored as a SNAPSHOT at assertion time, not
-- recomputed live on every read -- v_account_balances.current_balance
-- changes as transactions are added/backdated, and a later backdated entry
-- must not silently rewrite the drift of a check someone already did. The
-- assertion is a historical fact ("on this date, this was the drift"), not
-- a live view.
create table account_balance_assertions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  as_of_date date not null,
  asserted_balance numeric(14,2) not null,
  computed_balance numeric(14,2) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (account_id, as_of_date)
);

alter table account_balance_assertions enable row level security;

create policy account_balance_assertions_select on account_balance_assertions
  for select using (has_role(org_id, 'viewer'));
create policy account_balance_assertions_insert on account_balance_assertions
  for insert with check (has_role(org_id, 'editor'));
create policy account_balance_assertions_update on account_balance_assertions
  for update using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy account_balance_assertions_delete on account_balance_assertions
  for delete using (has_role(org_id, 'editor'));
