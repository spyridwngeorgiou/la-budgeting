-- 0031: «Εντολές & σημειώσεις» -- the shared board through which Claude,
-- ChatGPT and VS Code "talk": an instruction given to one (from any device)
-- is a row here that the others read and complete; a decision worth keeping
-- is a note every assistant sees. Rows are never deleted, only marked done.

create table ai_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null default 'task' check (kind in ('task', 'note')),
  title text not null,
  body text,
  project_id uuid references projects(id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_by text,          -- email of the person
  created_via text,         -- 'Claude', 'ChatGPT', 'VS Code', 'εφαρμογή'
  done_by text,
  done_via text,
  done_note text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  updated_at timestamptz not null default now()
);
create index ai_notes_open_idx on ai_notes (org_id, status, created_at desc);

create trigger ai_notes_set_updated_at before update on ai_notes
  for each row execute function set_updated_at();
create trigger ai_notes_log_activity after insert or update or delete on ai_notes
  for each row execute function log_activity();

alter table ai_notes enable row level security;
create policy ai_notes_select on ai_notes for select using (has_role(org_id, 'viewer'));
create policy ai_notes_write on ai_notes for all using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
