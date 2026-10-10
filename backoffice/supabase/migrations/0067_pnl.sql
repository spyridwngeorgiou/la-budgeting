-- 0067: results (P&L) -- one SQL definition read by /reports/pnl, the
-- project rollup and the assistant.
--
-- Accrual basis on tx_date (the invoice date), net of VAT: VAT is the
-- state's money passing through, so revenue and costs are net_amount. Every
-- line is decided by the category's cost_treatment (0020/0062) and, for
-- capex, the project's business model -- never per transaction:
--   * VAT, pass-through, principal and equity are not results at all
--   * capex is cost of sales on a client project (and on general work); on
--     an own development or a hotel lease it builds an asset and stays out
--     of the P&L (no depreciation: see «Τι ΔΕΝ φτιάχνουμε»)
--   * a loan payment contributes ONLY its interest (transactions
--     .interest_amount, 0065); the principal part is a balance-sheet flow
-- Scheduled rows are included and flagged, so the page can show "booked so
-- far" or "including what is already scheduled".

create function public.pnl_line(p_treatment cost_treatment, p_model business_model, p_direction tx_direction)
returns text
language sql immutable parallel safe as $$
  select case
    when p_treatment in ('vat', 'pass_through', 'principal', 'equity') then null
    when p_direction = 'income' then 'revenue'
    when p_treatment is null then 'unclassified'
    when p_treatment = 'capex' then
      case when p_model in ('own_development', 'hotel_lease') then null else 'cost_of_sales' end
    when p_treatment = 'opex' then 'opex'
    when p_treatment in ('rent', 'rent_substitute') then 'rent'
    when p_treatment = 'financing' then 'financing'
    when p_treatment = 'tax' then 'tax'
    else 'opex'
  end
$$;

comment on function public.pnl_line(cost_treatment, business_model, tx_direction) is
  'P&L line of a transaction: revenue | cost_of_sales | opex | rent | financing '
  '| tax | unclassified, or null when it is not a result (VAT, pass-through, '
  'principal, equity, capitalised capex).';

-- One row per transaction that reaches the P&L.
create view v_pnl_lines with (security_invoker = true) as
select t.id as transaction_id, t.org_id, t.tx_date,
       date_trunc('month', t.tx_date::timestamp)::date as month,
       t.project_id, coalesce(p.business_line, 'general'::business_line) as business_line,
       t.category_id, c.cost_treatment as treatment,
       x.line, t.direction, t.scope, t.status,
       t.status = 'scheduled' as is_scheduled,
       x.amount,
       case when t.direction = 'income' then x.amount else -x.amount end as signed_amount
from transactions t
left join categories c on c.id = t.category_id
left join projects p on p.id = t.project_id
cross join lateral (
  select
    case when t.loan_id is not null or t.interest_amount is not null then 'financing'
         else pnl_line(c.cost_treatment, p.business_model, t.direction) end as line,
    case when t.loan_id is not null or t.interest_amount is not null then coalesce(t.interest_amount, 0)
         else coalesce(t.net_amount, t.gross_amount - t.vat_amount + t.withholding_amount) end as amount
) x
where t.status <> 'cancelled'
  and x.line is not null
  and x.amount <> 0;

create view v_pnl_monthly with (security_invoker = true) as
select org_id, month, business_line, line, scope, is_scheduled,
       sum(signed_amount) as amount,
       count(*)::int as n
from v_pnl_lines
group by org_id, month, business_line, line, scope, is_scheduled;

-- v_project_rollup (0020) with three columns appended -- the only change
-- create-or-replace allows. net_result: the project's P&L result so far
-- (paid + pending); lifetime_result: including what is already scheduled.
create or replace view v_project_rollup with (security_invoker = true) as
with actual as (
  select
    t.project_id,
    t.direction,
    t.status,
    coalesce(c.cost_treatment, 'capex') as treatment,   -- unclassified counts against budget: conservative
    c.cost_treatment is null as treatment_unknown,
    t.gross_amount,
    t.vat_amount
  from transactions t
  left join categories c on c.id = t.category_id
  where t.status <> 'cancelled'
)
select
  p.id as project_id, p.org_id, p.code, p.display_name, p.status, p.business_model,
  coalesce(b.total_budget, 0) as total_budget,

  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.status='paid'), 0) as spent,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.status='pending'), 0) as pending,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.status='scheduled'), 0) as scheduled,
  coalesce(sum(a.vat_amount)   filter (where a.direction='expense'), 0) as vat_on_expenses,
  coalesce(sum(a.gross_amount) filter (where a.direction='income'  and a.status='paid'), 0) as income_received,
  coalesce(sum(a.gross_amount) filter (where a.direction='income'  and a.status in ('pending','scheduled')), 0) as income_expected,

  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment='capex' and a.status='paid'), 0) as capex_paid,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment='capex' and a.status in ('pending','scheduled')), 0) as capex_committed,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment in ('rent','rent_substitute')), 0) as occupancy_cost,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment not in ('capex','rent','rent_substitute')), 0) as other_opex,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment_unknown), 0) as unclassified_spend,

  coalesce(b.total_budget, 0)
    - coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment='capex' and a.status in ('paid','pending','scheduled')), 0)
    as remaining_budget,

  coalesce(r.net_result, 0) as net_result,
  coalesce(r.lifetime_result, 0) as lifetime_result,
  p.business_line
from projects p
left join actual a on a.project_id = p.id
left join lateral (
  select sum(bl.amount) as total_budget
  from project_budgets pb join budget_lines bl on bl.budget_id = pb.id
  where pb.project_id = p.id and pb.is_current
) b on true
left join lateral (
  select sum(l.signed_amount) filter (where not l.is_scheduled) as net_result,
         sum(l.signed_amount) as lifetime_result
  from v_pnl_lines l
  where l.project_id = p.id
) r on true
group by p.id, p.org_id, p.code, p.display_name, p.status, p.business_model, b.total_budget,
         r.net_result, r.lifetime_result, p.business_line;
