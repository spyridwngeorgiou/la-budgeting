-- 0030: one duplicate check for every way an entry can arrive (this chat via
-- scripts/staging.cjs, the Claude connector, the app). Same direction, same
-- amount to the cent, date within ±p_days (on the due date for open rows,
-- the payment date for paid ones). Callers show the matches and ask «ίδια ή
-- δύο;» before writing; nothing here blocks or writes.

create or replace function public.possible_duplicates(
  p_org uuid,
  p_date date,
  p_amount numeric,
  p_direction tx_direction,
  p_days int default 7
) returns table (
  id uuid,
  tx_date date,
  due_date date,
  paid_on date,
  status tx_status,
  gross_amount numeric,
  account text,
  project text,
  description text
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.tx_date, t.due_date, t.paid_on, t.status, t.gross_amount,
         a.name, p.display_name, t.description
  from transactions t
  left join accounts a on a.id = t.account_id
  left join projects p on p.id = t.project_id
  where t.org_id = p_org
    and t.status <> 'cancelled'
    and t.direction = p_direction
    and abs(t.gross_amount - p_amount) < 0.005
    and abs(coalesce(t.paid_on, t.due_date, t.tx_date) - p_date) <= p_days
  order by abs(coalesce(t.paid_on, t.due_date, t.tx_date) - p_date), t.tx_date
  limit 10;
$$;

grant execute on function public.possible_duplicates(uuid, date, numeric, tx_direction, int) to authenticated, service_role;
