-- 0069: budget vs actual per budget line, with the contingency reserve.
--
-- budget_lines (0006) split a project's envelope into acquisition / studies
-- / construction / other, but the ledger had no way to say which line a
-- euro belonged to, so only the project total could be compared. The line is
-- a property of the category (like cost_treatment): decided once, org-wide.

alter table categories add column budget_line_code budget_line_code;

comment on column categories.budget_line_code is
  'Which project budget line capex in this category consumes. Null on a capex '
  'category means «other» in v_project_budget_lines.';

update categories set budget_line_code = case code
  when 'ΑΓΟΡΆ_ΑΚΙΝΉΤΟΥ'     then 'acquisition'
  when 'ΑΜΟΙΒΉ_ΜΕΣΙΤΕΊΑΣ'   then 'acquisition'
  when 'ΆΔΕΙΕΣ_AND_ΜΕΛΈΤΕΣ' then 'studies_permits_legal'
  when 'ΥΛΙΚΆ'              then 'construction_equipment'
  when 'ΕΡΓΑΤΙΚΆ'           then 'construction_equipment'
  when 'ΥΠΕΡΓΟΛΆΒΟΙ'        then 'construction_equipment'
  when 'ΕΞΟΠΛΙΣΜΌΣ'         then 'construction_equipment'
  when 'ΜΕΤΑΦΟΡΙΚΆ'         then 'construction_equipment'
  else null
end::budget_line_code
where cost_treatment = 'capex';

-- One row per project and line of its current budget, plus a
-- 'contingency' row: the reserve (contingency_pct × the lines), how much of
-- it the overruns on the lines have already used, and what is left.
-- Same consumption rule as v_project_rollup.remaining_budget: gross capex,
-- unclassified spend counted as capex (conservative), paid + pending +
-- scheduled.
create view v_project_budget_lines with (security_invoker = true) as
with budget as (
  select pb.org_id, pb.project_id, pb.contingency_pct, bl.line_code::text as line_code, bl.label, bl.amount
  from project_budgets pb
  join budget_lines bl on bl.budget_id = pb.id
  where pb.is_current
), spend as (
  select t.project_id,
         coalesce(c.budget_line_code::text, 'other') as line_code,
         sum(t.gross_amount) filter (where t.status = 'paid') as paid,
         sum(t.gross_amount) filter (where t.status in ('pending', 'scheduled')) as committed
  from transactions t
  left join categories c on c.id = t.category_id
  where t.direction = 'expense' and t.status <> 'cancelled' and t.project_id is not null
    and coalesce(c.cost_treatment, 'capex') = 'capex'
  group by 1, 2
), lines as (
  select coalesce(b.org_id, p.org_id) as org_id, coalesce(b.project_id, s.project_id) as project_id,
         coalesce(b.line_code, s.line_code) as line_code, b.label,
         coalesce(b.amount, 0) as budget,
         coalesce(s.paid, 0) as paid, coalesce(s.committed, 0) as committed
  from budget b
  full join spend s on s.project_id = b.project_id and s.line_code = b.line_code
  left join projects p on p.id = s.project_id
  where coalesce(b.project_id, s.project_id) in (select project_id from project_budgets where is_current)
)
select l.org_id, l.project_id, l.line_code, l.label, l.budget, l.paid, l.committed,
       l.budget - l.paid - l.committed as remaining
from lines l
union all
select pb.org_id, pb.project_id, 'contingency', null,
       round(pb.contingency_pct * coalesce(tot.budget, 0), 2),
       0, coalesce(tot.overrun, 0),
       round(pb.contingency_pct * coalesce(tot.budget, 0), 2) - coalesce(tot.overrun, 0)
from project_budgets pb
left join lateral (
  select sum(l.budget) as budget, sum(greatest(0, l.paid + l.committed - l.budget)) as overrun
  from lines l where l.project_id = pb.project_id
) tot on true
where pb.is_current;

comment on view v_project_budget_lines is
  'Budget vs actual per line (acquisition, studies_permits_legal, '
  'construction_equipment, other) of each project''s current budget, plus a '
  'contingency row whose "committed" is the overrun the lines have consumed.';
