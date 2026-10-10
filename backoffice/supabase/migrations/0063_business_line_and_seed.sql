-- 0063: business line on projects, the principal/equity treatments, the
-- financing categories every org needs, and the business's own "today".

-- ── Today, in Athens ────────────────────────────────────────────────────────
-- current_date is the session time zone's date (UTC on Supabase): between
-- 00:00 and 03:00 Athens time it is still yesterday. Every view from 0063 on
-- uses this instead, matching todayAthens() in src/lib/dates.ts.
create function public.athens_today() returns date
language sql stable parallel safe as $$
  select (now() at time zone 'Europe/Athens')::date
$$;

-- ── Business line ───────────────────────────────────────────────────────────
-- Derived, not entered: a hotel lease is hospitality, a client build is
-- construction, an own development is an investment. Brokerage is never
-- derived -- a project only lands there when someone says so.
create function public.derive_business_line(p_type project_type, p_model business_model)
returns business_line
language sql immutable parallel safe as $$
  select case
    when p_model = 'hotel_lease' or p_type = 'hospitality' then 'hospitality'
    when p_model = 'own_development' then 'investments'
    when p_model = 'client_project' then 'construction'
    when p_type in ('construction', 'installation', 'renovation') then 'construction'
    else 'general'
  end::business_line
$$;

alter table projects add column business_line business_line;

update projects set business_line = derive_business_line(project_type, business_model);

-- Fills the line when nobody chose one, and keeps following project_type /
-- business_model for as long as it still equals what they imply -- a line
-- someone set by hand (e.g. brokerage) is never overwritten.
create function public.projects_set_business_line() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.business_line is null then
      new.business_line := derive_business_line(new.project_type, new.business_model);
    end if;
  elsif new.business_line is null
     or (new.business_line = old.business_line
         and old.business_line = derive_business_line(old.project_type, old.business_model)
         and (new.project_type is distinct from old.project_type
              or new.business_model is distinct from old.business_model)) then
    new.business_line := derive_business_line(new.project_type, new.business_model);
  end if;
  return new;
end;
$$;

create trigger projects_business_line
  before insert or update of project_type, business_model, business_line on projects
  for each row execute function projects_set_business_line();

alter table projects alter column business_line set not null;

comment on column projects.business_line is
  'Κλάδος: which part of the business this project''s income and costs belong '
  'to in the P&L and the forecast. Derived from project_type/business_model '
  'by trigger unless set explicitly.';

-- ── Principal ───────────────────────────────────────────────────────────────
-- is_financing (0003) flagged the workbook's «Δάνειο» rows: money borrowed or
-- repaid. That is principal, not a cost. Bank charges keep 'financing'.
update categories
set cost_treatment = 'principal'
where is_financing
  and coalesce(cost_treatment::text, 'financing') = 'financing'
  and code is distinct from 'ΤΡΑΠΕΖΙΚΆ';

-- ── Categories the schedules and the P&L rely on ────────────────────────────
-- Seeded for every existing org; looked up by code (never by id) from
-- src/lib/finance/scheduleRows.ts, which falls back to no category when an
-- org has deleted one.
insert into categories (org_id, code, name, kind, scope, is_financing, cost_treatment, sort_order)
select o.id, v.code, v.name, v.kind::tx_direction, 'business', v.is_financing, v.treatment::cost_treatment, 900 + v.ord
from orgs o
cross join (values
  ('ΤΟΚΟΧΡΕΟΛΎΣΙΑ',      'Τοκοχρεολύσια δανείων', 'expense', true,  'principal', 1),
  ('ΚΕΦΆΛΑΙΟ_ΔΑΝΕΊΟΥ',   'Κεφάλαιο δανείου',      null,      true,  'principal', 2),
  ('ΚΕΦΆΛΑΙΟ_ΙΔΙΟΚΤΉΤΗ', 'Κεφάλαιο ιδιοκτήτη',    null,      false, 'equity',    3)
) as v(code, name, kind, is_financing, treatment, ord)
on conflict (org_id, code) do nothing;

comment on column categories.cost_treatment is
  'The only thing that decides whether a euro consumes a project''s capex '
  'budget, and which P&L line it lands on (pnl_line, 0067). principal and '
  'equity are balance-sheet flows and never reach the P&L; for a '
  'ΤΟΚΟΧΡΕΟΛΎΣΙΑ row the P&L reads only transactions.interest_amount. '
  'Null means "not yet classified" (v_qc_spend_without_treatment).';
