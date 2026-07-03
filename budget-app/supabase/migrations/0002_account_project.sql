-- Earmark accounts (e.g. a loan) to a specific project so they are excluded
-- from the general/holistic totals and shown only under that project.

alter table public.accounts
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_accounts_project on public.accounts(project_id);

-- Earmark the TEPIX loan to the "Λαζαράκη 5" project (per household).
update public.accounts a
set project_id = p.id
from public.projects p
where a.name = 'Δάνειο TEPIX'
  and p.name = 'Λαζαράκη 5'
  and p.household_id = a.household_id;
