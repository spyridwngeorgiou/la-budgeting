-- 0011: computed views
-- Rule for anything derivable: if a value can change without anyone editing
-- the row, it is a view, never a stored column. This is what eliminates the
-- staleness the workbook suffers from (e.g. its account-balance SUMIFS is
-- missing a date guard -- fixed in v_account_balances below).

-- Account balances: opening + movements strictly after opening_balance_date.
-- The workbook's SUMIFS lacks that date guard, so a paid transaction dated
-- before the opening-balance snapshot gets double-counted there; fixed here.
create view v_account_balances as
select
  a.id as account_id, a.org_id, a.name, a.kind, a.owner_scope, a.is_liquid,
  a.opening_balance, a.opening_balance_date,
  a.opening_balance + coalesce(sum(t.signed_amount) filter (
    where t.status = 'paid' and t.tx_date >= a.opening_balance_date
  ), 0) as current_balance
from accounts a
left join transactions t on t.account_id = a.id and t.org_id = a.org_id
group by a.id, a.org_id, a.name, a.kind, a.owner_scope, a.is_liquid,
         a.opening_balance, a.opening_balance_date;

-- Project rollup: budget / spent / pending / scheduled / VAT / remaining.
-- Status 'scheduled' is INCLUDED here (real exposure) but excluded from the
-- cash forecast view below -- reproducing the workbook's distinction.
create view v_project_rollup as
select
  p.id as project_id, p.org_id, p.code, p.display_name, p.status, p.business_model,
  coalesce(b.total_budget, 0) as total_budget,
  coalesce(sum(t.gross_amount) filter (where t.direction='expense' and t.status='paid'), 0) as spent,
  coalesce(sum(t.gross_amount) filter (where t.direction='expense' and t.status='pending'), 0) as pending,
  coalesce(sum(t.gross_amount) filter (where t.direction='expense' and t.status='scheduled'), 0) as scheduled,
  coalesce(sum(t.vat_amount) filter (where t.direction='expense'), 0) as vat_on_expenses,
  coalesce(sum(t.gross_amount) filter (where t.direction='income' and t.status='paid'), 0) as income_received,
  coalesce(sum(t.gross_amount) filter (where t.direction='income' and t.status in ('pending','scheduled')), 0) as income_expected,
  coalesce(b.total_budget, 0)
    - coalesce(sum(t.gross_amount) filter (where t.direction='expense' and t.status in ('paid','pending','scheduled')), 0)
    as remaining_budget
from projects p
left join transactions t on t.project_id = p.id and t.org_id = p.org_id and t.status <> 'cancelled'
left join lateral (
  select sum(bl.amount) as total_budget
  from project_budgets pb join budget_lines bl on bl.budget_id = pb.id
  where pb.project_id = p.id and pb.is_current
) b on true
group by p.id, p.org_id, p.code, p.display_name, p.status, p.business_model, b.total_budget;

-- Contact rollup: Σύνολο Εσόδων / Εξόδων / Εκκρεμή / Καθαρό Υπόλοιπο
create view v_contact_rollup as
select
  c.id as contact_id, c.org_id, c.name, c.afm,
  coalesce(sum(t.gross_amount) filter (where t.direction='income' and t.status='paid'), 0) as total_income,
  coalesce(sum(t.gross_amount) filter (where t.direction='expense' and t.status='paid'), 0) as total_expense,
  coalesce(sum(t.gross_amount) filter (where t.status in ('pending','scheduled')), 0) as outstanding,
  coalesce(sum(t.gross_amount) filter (where t.direction='income' and t.status='paid'), 0)
    - coalesce(sum(t.gross_amount) filter (where t.direction='expense' and t.status='paid'), 0)
    as net_balance
from contacts c
left join transactions t on t.contact_id = c.id and t.org_id = c.org_id and t.status <> 'cancelled'
group by c.id, c.org_id, c.name, c.afm;

-- VAT position: closed-form equivalent of the workbook's row-by-row
-- recursion credit_n = MIN(0, net_n + credit_{n-1}). Checked on worked
-- examples: nets (-100,+30,+50) -> credits (-100,-70,-20), payables (0,0,0);
-- nets (-100,+150,+50) -> credits (-100,0,0), payables (0,50,50).
create view v_vat_position as
with base as (
  select org_id, date_trunc('month', tx_date)::date as period_start,
         sum(vat_amount) filter (where direction='income')  as vat_income,
         sum(vat_amount) filter (where direction='expense') as vat_expense
  from transactions
  where scope = 'business' and status <> 'cancelled'
  group by 1,2
), calc as (
  select *, vat_income - vat_expense as net_position,
         sum(vat_income - vat_expense) over (
           partition by org_id order by period_start
           rows between unbounded preceding and current row) as running
  from base
)
select org_id, period_start, vat_income, vat_expense, net_position,
       least(0, running) as credit_balance,
       greatest(0, running - greatest(0, lag(running,1,0) over (partition by org_id order by period_start)))
         as payable_after_credit,
       (date_trunc('month', period_start) + interval '2 month - 1 day')::date as filing_deadline
from calc;

-- Withholding: expense side only for the workbook-faithful figure; a QC view
-- separately flags withholding recorded on an income row as a warning (myDATA
-- does report it when a client withholds from you) rather than rejecting it.
create view v_withholding_position as
select org_id, date_trunc('month', tx_date)::date as period_start,
       sum(withholding_amount) as withheld_total
from transactions
where scope = 'business' and direction = 'expense' and status <> 'cancelled'
group by 1,2;

-- Plan progress: replaces the workbook's nine derived recurring-row columns.
-- Ημ/νία Τελ. Πληρωμένης Δόσης in particular required a human to retype it
-- every month on every open plan -- this view removes that entirely.
create view v_plan_progress as
select
  p.id as plan_id, p.org_id, p.label, p.status,
  count(t.id) as installments_total,
  count(t.id) filter (where t.status = 'paid') as paid_count,
  coalesce(sum(t.gross_amount) filter (where t.status = 'paid'), 0) as paid_amount,
  coalesce(sum(t.gross_amount) filter (where t.status <> 'paid'), 0) as remaining_amount,
  count(t.id) filter (where t.status <> 'paid' and t.due_date < current_date) as overdue_count,
  coalesce(sum(t.gross_amount) filter (where t.status <> 'paid' and t.due_date < current_date), 0) as overdue_amount,
  min(t.due_date) filter (where t.status <> 'paid') as next_due_date,
  max(t.tx_date) filter (where t.status = 'paid') as last_paid_date
from installment_plans p
left join transactions t on t.plan_id = p.id
group by p.id, p.org_id, p.label, p.status;

-- Parameterised "due within N days" -- replaces the workbook's three
-- hardcoded 30/180/365 columns with one function callable for any horizon.
create or replace function public.v_due_within(p_org_id uuid, p_days int)
returns table(total_amount numeric)
language sql stable as $$
  select coalesce(sum(gross_amount), 0)
  from transactions
  where org_id = p_org_id and status in ('pending','scheduled')
    and due_date between current_date and current_date + p_days
$$;

-- Cash forecast: 'scheduled' status is EXCLUDED here (real exposure, not yet
-- a cash-timing event) though it is included in v_project_rollup and VAT --
-- exactly the distinction the workbook's Ταμείο sheet draws.
create view v_cashflow_monthly as
select
  t.org_id, a.owner_scope, date_trunc('month', t.tx_date)::date as month,
  sum(t.gross_amount) filter (where t.direction='income' and t.status='paid') as inflow,
  sum(t.gross_amount) filter (where t.direction='expense' and t.status='paid') as outflow,
  sum(t.gross_amount * coalesce(t.collection_probability,1))
    filter (where t.direction='income' and t.status='pending') as weighted_expected_inflow
from transactions t
join accounts a on a.id = t.account_id
where t.status <> 'scheduled' and t.status <> 'cancelled'
group by t.org_id, a.owner_scope, date_trunc('month', t.tx_date)::date;

-- Net worth: liquid balances + assets (by ownership %, excluding
-- pending_inheritance) - liabilities. Mirrors the workbook's wealth block.
create view v_net_worth as
select
  o.id as org_id,
  (select coalesce(sum(current_balance),0) from v_account_balances b where b.org_id = o.id) as liquid_total,
  (select coalesce(sum(estimated_value * ownership_pct),0) from assets a
     where a.org_id = o.id and a.state = 'held') as asset_total,
  (select coalesce(sum(principal),0) from liabilities l where l.org_id = o.id
     and l.state <> 'repaid') as liability_total
from orgs o;

-- Data quality checks, ported from the workbook's Έλεγχοι Ποιότητας sheet.
-- Each surfaces the offending row ids so the UI can link straight to them.

create view v_qc_duplicate_invoice_numbers as
select org_id, invoice_number, array_agg(id) as transaction_ids, count(*) as n
from transactions
where invoice_number is not null and invoice_number <> ''
group by org_id, invoice_number having count(*) > 1;

create view v_qc_missing_project_or_account as
select id as transaction_id, org_id, tx_date, description
from transactions
where (project_id is null or account_id is null) and status <> 'cancelled';

create view v_qc_vat_mismatch as
select id as transaction_id, org_id, tx_date, net_amount, vat_amount, vat_rate,
       round(net_amount * vat_rate, 2) as expected_vat
from transactions
where vat_rate is not null and net_amount is not null
  and abs(vat_amount - round(net_amount * vat_rate, 2)) > 0.02;

create view v_qc_amount_identity_mismatch as
select id as transaction_id, org_id, tx_date,
       net_amount + vat_amount - withholding_amount as expected_gross, gross_amount
from transactions
where net_amount is not null
  and abs((net_amount + vat_amount - withholding_amount) - gross_amount) > 0.02;

create view v_qc_contacts_missing_afm as
select id as contact_id, org_id, name from contacts where afm is null or afm = '';

create view v_qc_duplicate_fingerprints as
select org_id, fingerprint, array_agg(id) as transaction_ids, count(*) as n
from transactions
where fingerprint is not null
group by org_id, fingerprint having count(*) > 1;

create view v_qc_future_dated as
select id as transaction_id, org_id, tx_date
from transactions
where tx_date > current_date + 2 and status <> 'scheduled';

create view v_qc_non_positive_amounts as
select id as transaction_id, org_id, gross_amount
from transactions where gross_amount <= 0;

create view v_qc_duplicate_contact_afm as
select org_id, afm, array_agg(id) as contact_ids, count(*) as n
from contacts where afm is not null and afm <> ''
group by org_id, afm having count(*) > 1;

create view v_qc_projects_without_budget as
select p.id as project_id, p.org_id, p.display_name
from projects p
where not exists (
  select 1 from project_budgets pb where pb.project_id = p.id and pb.is_current
);

create view v_qc_afm_mismatch as
select t.id as transaction_id, t.org_id, t.counterparty_afm, c.afm as contact_afm
from transactions t
join contacts c on c.id = t.contact_id
where t.counterparty_afm is not null and t.counterparty_afm <> c.afm;

create view v_qc_withholding_on_income as
select id as transaction_id, org_id, tx_date, withholding_amount
from transactions
where direction = 'income' and withholding_amount > 0;
