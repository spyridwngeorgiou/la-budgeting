-- 0018: Kansha Operator's write path.
--
-- The chat assistant can now be asked to change master data ("rename this
-- contact", "delete this project") anywhere in the app -- but it never
-- writes directly. It proposes a change here; a human reviews the
-- before/after diff and approves or rejects it. This is the exact same
-- guarantee transaction_drafts already gives receipts/voice/text entry
-- (0010_ai_documents.sql), generalised to master data instead of ledger
-- rows: no auto-commit exists anywhere in this codebase, not even behind a
-- setting.

create type agent_change_op as enum ('insert', 'update', 'delete');
create type agent_change_status as enum ('pending', 'approved', 'rejected');

create table agent_changes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  table_name text not null,          -- restricted to an app-level allowlist, not enforced in SQL
  row_id uuid,                       -- null for insert
  operation agent_change_op not null,
  before jsonb,                      -- null for insert
  after jsonb not null,              -- the full proposed row state (insert/update) or the row being removed (delete, mirrors `before`)
  reason text,                       -- the model's own explanation, shown to the reviewer
  status agent_change_status not null default 'pending',
  requested_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,

  constraint agent_change_insert_shape check (operation <> 'insert' or (row_id is null and before is null)),
  constraint agent_change_mutation_shape check (operation = 'insert' or (row_id is not null and before is not null))
);

create index on agent_changes (org_id, status, created_at desc);

alter table agent_changes enable row level security;

create policy agent_changes_select on agent_changes for select
  using (has_role(org_id, 'viewer'));

create policy agent_changes_insert on agent_changes for insert
  with check (has_role(org_id, 'editor'));

-- Only the status/reviewed_* fields are ever updated post-creation (approve
--/reject), by the review screen's server action -- editors only, same bar
-- as everything else.
create policy agent_changes_update on agent_changes for update
  using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
