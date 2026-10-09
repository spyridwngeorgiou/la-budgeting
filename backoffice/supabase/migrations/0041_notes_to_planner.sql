-- 0041: project_notes "action"/"milestone" rows move to the planner
--
-- After this, project_notes is only the ΚΑΤΑΣΤΑΣΗ block's status and risk
-- bullets; anything with a date and an owner lives in tasks /
-- project_milestones (0040). A note that carried an exposure_amount (the
-- €16.100 kind) is a financial risk as well as a to-do, so it stays behind
-- as a 'risk' note and the new task/milestone points back at it via
-- source_note_id. Plain ones are removed once copied; the snapshot below is
-- the only place their original rows survive.

-- Pending Kansha Operator proposals against project_notes were built for the
-- old shape: an insert of kind action/milestone would hit the CHECK below on
-- approval, and an update/delete may target a row this migration removes.
-- Refuse to run rather than guess -- approve or reject them at /changes
-- first.
do $$
declare
  v_pending int;
begin
  select count(*) into v_pending
  from agent_changes
  where table_name = 'project_notes' and status = 'pending'
    and (after->>'kind' in ('action', 'milestone')
         or row_id in (select id from project_notes where kind in ('action', 'milestone')));
  if v_pending > 0 then
    raise exception '0041: % pending agent_changes touch action/milestone project_notes; resolve them at /changes first', v_pending;
  end if;
end $$;

create table project_notes_premigration_0041 as
  select n.*, now() as snapshot_at
  from project_notes n
  where n.kind in ('action', 'milestone');
alter table project_notes_premigration_0041 add primary key (id);
-- Audit copy for whoever runs the migration, not app data: RLS on with no
-- policies, so only the table owner (postgres / service role) can read it.
alter table project_notes_premigration_0041 enable row level security;
revoke all on project_notes_premigration_0041 from anon, authenticated;

-- First line of the note becomes the title; the full text is kept as the
-- description whenever the title had to drop anything.
insert into project_milestones (
  org_id, project_id, title, description, kind, due_date, done_at,
  source_note_id, sort_order, created_by, created_at
)
select n.org_id, n.project_id,
       left(split_part(btrim(n.body), E'\n', 1), 200),
       case when btrim(n.body) <> left(split_part(btrim(n.body), E'\n', 1), 200) then n.body end,
       'general',
       coalesce(n.due_date, n.created_at::date),
       n.resolved_at,
       n.id, n.sort_order, n.created_by, n.created_at
from project_notes n
where n.kind = 'milestone' and btrim(n.body) <> '';

insert into tasks (
  org_id, project_id, title, description, status, priority, due_date,
  completed_at, sort_key, source_note_id, created_by, created_at
)
select n.org_id, n.project_id,
       left(split_part(btrim(n.body), E'\n', 1), 200),
       case when btrim(n.body) <> left(split_part(btrim(n.body), E'\n', 1), 200) then n.body end,
       case when n.resolved_at is not null then 'done' else 'todo' end::task_status,
       case n.severity when 'urgent' then 'urgent' when 'watch' then 'high' else 'normal' end::task_priority,
       n.due_date,
       n.resolved_at,
       -- Same spacing sortKey.ts uses for a fresh column.
       1024 * row_number() over (
         partition by n.project_id, n.resolved_at is not null
         order by n.sort_order, n.created_at),
       n.id, n.created_by, n.created_at
from project_notes n
where n.kind = 'action' and btrim(n.body) <> '';

update project_notes
set kind = 'risk'
where kind in ('action', 'milestone') and exposure_amount is not null;

delete from project_notes where kind in ('action', 'milestone');

-- The enum keeps its four values (dropping enum values means rebuilding the
-- type and every dependent view); the constraint is what stops new ones.
alter table project_notes add constraint project_notes_kind_status_risk
  check (kind in ('status', 'risk'));
