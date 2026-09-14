-- 0010: AI ingestion tables — created now, used once AI_ENABLED is turned on.
-- Hard guarantee: AI output lands in transaction_drafts, never in
-- transactions. The only path into the ledger is the approveDraft server
-- action, which re-runs every validator server-side. No auto-commit exists,
-- not even behind a setting.

create table document_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  status text not null default 'queued',   -- queued|processing|extracted|failed|discarded
  attempts int not null default 0,
  last_error text,
  model text,
  input_tokens int,
  output_tokens int,
  cost_cents numeric(10,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger document_jobs_set_updated_at before update on document_jobs
  for each row execute function set_updated_at();

create table transaction_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  source tx_origin not null,               -- ai_document | ai_nl
  extracted jsonb not null,                -- raw model output incl. per-field evidence
  proposed  jsonb not null,                -- resolved ids + server-derived money
  needs_review_reasons text[] not null default '{}',
  status text not null default 'pending',  -- pending | approved | discarded
  approved_transaction_id uuid references transactions(id),
  created_at timestamptz not null default now()
);

create table ai_corrections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid references documents(id),
  field text not null,
  ai_value jsonb,
  human_value jsonb,
  model text,
  created_at timestamptz not null default now()
);

create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  feature text not null,
  model text not null,
  input_tokens int,
  cache_read_tokens int,
  output_tokens int,
  cost_cents numeric(10,4),
  user_id uuid references auth.users(id),
  request_id text,
  created_at timestamptz not null default now()
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete cascade,
  storage_path text not null,
  filename text,
  mime_type text,
  size_bytes int,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);

comment on table transaction_drafts is
  'AI-extracted or NL-parsed proposals awaiting human review. Never written '
  'to directly by an AI call''s result -- always via a server action that '
  're-validates. approveDraft() is the only writer of transactions.origin '
  'in (''ai_document'',''ai_nl'').';

comment on table ai_corrections is
  'One row per field changed between draft and human-approved value. Feeds '
  'an accuracy dashboard and, later, a few-shot corpus -- built from the '
  'first version of approveDraft() so no signal is lost retrofitting it.';
