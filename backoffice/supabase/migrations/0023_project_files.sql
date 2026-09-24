-- 0023: project files -- everything a project accumulates (permits, plans,
-- offers, business plans, photos), filed by folder, in date order.
--
-- The files themselves stay where they are worked on (Google Drive): a row
-- here is a catalogue entry pointing at the live file, not a copy. That keeps
-- them editable in place and keeps the 1 GB free Storage quota for receipt
-- photos. source = 'upload' is for the occasional file stored in the
-- 'documents' bucket instead (storage_path set, url null).
--
-- Duplicates found when cataloguing (same name modulo a " 2" suffix, same
-- size and modified time) are kept as rows with duplicate_of set, so the
-- catalogue can prove nothing was lost while the page shows each file once.

create table project_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  folder text[] not null default '{}',          -- e.g. {5_ΣΧΕΔΙΑ_ΦΩΤΟ,ΚΑΤΟΨΕΙΣ_ΦΑΣΗ_Α}
  title text not null,
  mime_type text,
  size_bytes bigint,
  source text not null default 'google_drive' check (source in ('google_drive', 'upload')),
  external_id text,                              -- Drive file id
  url text,                                      -- Drive view link
  storage_path text,                             -- when source = 'upload'
  file_modified_at timestamptz,
  duplicate_of uuid references project_files(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_files_location check (url is not null or storage_path is not null)
);

create unique index project_files_external_uq on project_files (org_id, source, external_id)
  where external_id is not null;
create index project_files_project_idx on project_files (project_id, file_modified_at desc);

create trigger project_files_set_updated_at before update on project_files
  for each row execute function set_updated_at();

alter table project_files enable row level security;
create policy project_files_select on project_files for select using (has_role(org_id, 'viewer'));
create policy project_files_insert on project_files for insert with check (has_role(org_id, 'editor'));
create policy project_files_update on project_files for update
  using (has_role(org_id, 'editor')) with check (has_role(org_id, 'editor'));
create policy project_files_delete on project_files for delete using (has_role(org_id, 'editor'));
