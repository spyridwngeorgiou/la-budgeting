-- 0026: email ingestion channel.
--
-- Lets invoices/receipts arriving by email become AI-extracted transaction
-- drafts, same invariant as the photo/NL channels: transaction_drafts only,
-- never transactions directly (see 0010's comment). ai_email is a new
-- tx_origin value so drafts/approved transactions can be told apart from
-- ai_document/ai_nl in reporting.

alter type tx_origin add value 'ai_email';

-- Maps an inbound email recipient address to the org it belongs to -- no
-- user session exists on this path (it's a webhook, not a logged-in
-- request), so this is how the inbound route -- a service-role client,
-- bypassing RLS -- decides which org's data to touch. One row per alias,
-- not per org, so one org can eventually claim more than one address (or a
-- second org can be onboarded) without a schema change.
create table email_inbound_addresses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  address text not null unique,
  created_at timestamptz not null default now()
);

alter table email_inbound_addresses enable row level security;

create policy email_inbound_addresses_select on email_inbound_addresses
  for select using (has_role(org_id, 'viewer'));
create policy email_inbound_addresses_insert on email_inbound_addresses
  for insert with check (has_role(org_id, 'admin'));
create policy email_inbound_addresses_delete on email_inbound_addresses
  for delete using (has_role(org_id, 'admin'));

-- No seed row here on purpose -- the real inbound address depends on a
-- domain decision that hasn't been made yet. Insert it manually once
-- chosen, e.g.:
--   insert into email_inbound_addresses (org_id, address)
--   values ('<org-id>', 'ingest@bills.example.com');
