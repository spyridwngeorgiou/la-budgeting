-- 0034: payments hang on a project phase, and phases hang on each other.
--
--   transactions.phase_id      the phase (permit, loan, construction A ...) an
--                              open payment belongs to.
--   project_phases.depends_on  the phase this one follows (construction A
--                              follows the loan, the loan follows the permit).
--
-- Moving a phase (a change of planned_start) moves, by the same number of
-- days: its open payments (pending/scheduled -- paid rows are history and
-- never move) and every not-done phase that depends on it, which in turn
-- moves its own payments and dependants. pg_trigger_depth() stops a
-- depends_on loop from running forever.

alter table project_phases add column depends_on uuid references project_phases(id) on delete set null;
alter table transactions add column phase_id uuid references project_phases(id) on delete set null;
create index transactions_phase_idx on transactions (phase_id) where phase_id is not null;

create or replace function public.shift_phase() returns trigger
language plpgsql set search_path = public as $$
declare
  v_delta int := new.planned_start - old.planned_start;
begin
  if v_delta = 0 or pg_trigger_depth() > 20 then
    return new;
  end if;

  update transactions
     set tx_date = tx_date + v_delta,
         due_date = case when due_date is null then null else due_date + v_delta end
   where phase_id = new.id and status in ('pending', 'scheduled');

  update project_phases
     set planned_start = planned_start + v_delta,
         planned_end = planned_end + v_delta
   where depends_on = new.id and status <> 'done';

  return new;
end;
$$;

create trigger project_phases_shift after update of planned_start on project_phases
  for each row execute function shift_phase();
