-- 0020: cost treatment -- the classification firewall
--
-- The Q004 workbook reports a −71.019 "apparent overrun" and then spends a
-- whole row explaining that it is not real: 70.449 of the landlord's AADE tax
-- settlements, which Kansha services INSTEAD of paying rent, had been counted
-- as renovation commitments. That is one bucket holding two unrelated things.
--
-- The fix is a property of the category, decided once, org-wide, visibly --
-- not a judgement call made per transaction at entry time, which is exactly
-- how it went wrong in the first place. Three layers follow from it:
--   1. definitional -- v_project_capex_position counts only 'capex'
--   2. preventive  -- a trigger refuses a capex category on a rent/tax/loan plan
--   3. detective   -- v_qc_* surfaces whatever still slips through, on /quality

create type cost_treatment as enum (
  'capex',            -- consumes the project_budgets envelope
  'opex',             -- operating cost: hits the result, never the budget
  'rent',             -- lease payment to the lessor
  'rent_substitute',  -- Q004: servicing the landlord's AADE debt in lieu of rent
  'financing',        -- interest, principal, bank charges
  'tax',              -- the company's own taxes
  'vat',
  'pass_through',     -- collected and remitted, not a cost
  'income'
);

alter table categories add column cost_treatment cost_treatment;

comment on column categories.cost_treatment is
  'The only thing that decides whether a euro consumes a project''s capex '
  'budget. Null means "not yet classified" and is surfaced by '
  'v_qc_spend_without_treatment; for budget purposes an unclassified '
  'project expense is treated as capex, the conservative direction -- it can '
  'overstate consumption, never hide an overrun.';

update categories set cost_treatment = case code
  when 'ΥΛΙΚΆ'                   then 'capex'
  when 'ΕΡΓΑΤΙΚΆ'                then 'capex'
  when 'ΥΠΕΡΓΟΛΆΒΟΙ'             then 'capex'
  when 'ΕΞΟΠΛΙΣΜΌΣ'              then 'capex'
  when 'ΜΕΤΑΦΟΡΙΚΆ'              then 'capex'
  when 'ΆΔΕΙΕΣ_AND_ΜΕΛΈΤΕΣ'      then 'capex'
  when 'ΑΓΟΡΆ_ΑΚΙΝΉΤΟΥ'          then 'capex'
  when 'ΑΜΟΙΒΉ_ΜΕΣΙΤΕΊΑΣ'        then 'capex'   -- Q004 carries it as a budget line
  when 'ΕΝΟΊΚΙΑ_AND_ΜΙΣΘΏΜΑΤΑ'   then 'rent'
  when 'ΛΕΙΤΟΥΡΓΙΚΆ'             then 'opex'
  when 'ΑΜΟΙΒΉ_ΔΙΑΧΕΊΡΙΣΗΣ'      then 'opex'
  when 'ΛΟΓΙΣΤΙΚΆ_AND_ΝΟΜΙΚΆ'    then 'opex'
  when 'ΤΡΑΠΕΖΙΚΆ'               then 'financing'
  when 'ΦΌΡΟΙ_AND_ΡΥΘΜΊΣΕΙΣ'     then 'tax'
  when 'ΕΝΦΙΑ'                   then 'tax'
  when 'ΠΏΛΗΣΗ_ΑΚΙΝΉΤΟΥ'         then 'income'
  when 'ΈΣΟΔΑ_ΦΙΛΟΞΕΝΊΑΣ'        then 'income'
  when 'ΑΝΑΧΡΈΩΣΗ_ΚΌΣΤΟΥΣ'       then 'income'
  when 'ΡΕΥΣΤΟΠΟΊΗΣΗ_ΠΕΡΙΟΥΣΊΑΣ' then 'income'
  else null
end::cost_treatment;

-- A dedicated child category so the Q004 settlements are findable as a group
-- and their economic meaning (a rent substitute, not a tax the company owes)
-- is not lost the moment someone else looks at the ledger.
insert into categories (org_id, code, name, kind, scope, parent_id, cost_treatment, sort_order)
select c.org_id, 'ΡΥΘΜΊΣΕΙΣ_ΑΝΤΊ_ΜΙΣΘΏΜΑΤΟΣ', 'Ρυθμίσεις ΑΑΔΕ αντί μισθώματος',
       'expense', 'business', c.id, 'rent_substitute', c.sort_order
from categories c
where c.code = 'ΕΝΟΊΚΙΑ_AND_ΜΙΣΘΏΜΑΤΑ'
on conflict (org_id, code) do update set cost_treatment = excluded.cost_treatment;

-- What kind of obligation an instalment plan services. Lets the guard below
-- reason about plans without inspecting their category.
create type obligation_kind as enum (
  'rent', 'third_party_tax_settlement', 'supplier', 'own_tax', 'loan', 'other'
);

alter table installment_plans
  add column obligation_kind obligation_kind not null default 'other';

-- Layer 2: prevention. An instalment of a rent, third-party settlement, own-tax
-- or loan plan can never carry a capex category -- which is precisely the Q004
-- entry, now rejected at insert time with a Greek message.
create or replace function public.tx_treatment_guard() returns trigger
language plpgsql as $$
declare
  v_treatment cost_treatment;
  v_obligation obligation_kind;
begin
  if new.category_id is null or new.plan_id is null then
    return new;
  end if;

  select cost_treatment into v_treatment from categories where id = new.category_id;
  select obligation_kind into v_obligation from installment_plans where id = new.plan_id;

  if v_treatment = 'capex'
     and v_obligation in ('third_party_tax_settlement', 'rent', 'own_tax', 'loan') then
    raise exception
      'Κατηγορία επενδυτικής δαπάνης δεν επιτρέπεται σε δόση τύπου %. '
      'Οι δόσεις αυτές είναι λειτουργικό κόστος, δεν καταναλώνουν προϋπολογισμό έργου.',
      v_obligation;
  end if;

  return new;
end; $$;

create trigger transactions_treatment_guard
  before insert or update of category_id, plan_id on transactions
  for each row execute function tx_treatment_guard();

-- Layer 1: definition. Budget consumption counts capex and nothing else, and
-- every other treatment is reported alongside rather than hidden -- a filter
-- the user can see and agree with is not the same thing as a silent one.
drop view if exists v_project_rollup;

create view v_project_rollup as
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

  -- Unchanged, so nothing downstream breaks: every expense on the project.
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.status='paid'), 0) as spent,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.status='pending'), 0) as pending,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.status='scheduled'), 0) as scheduled,
  coalesce(sum(a.vat_amount)   filter (where a.direction='expense'), 0) as vat_on_expenses,
  coalesce(sum(a.gross_amount) filter (where a.direction='income'  and a.status='paid'), 0) as income_received,
  coalesce(sum(a.gross_amount) filter (where a.direction='income'  and a.status in ('pending','scheduled')), 0) as income_expected,

  -- New: the capex/opex split that makes the budget comparison honest.
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment='capex' and a.status='paid'), 0) as capex_paid,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment='capex' and a.status in ('pending','scheduled')), 0) as capex_committed,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment in ('rent','rent_substitute')), 0) as occupancy_cost,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment not in ('capex','rent','rent_substitute')), 0) as other_opex,
  coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment_unknown), 0) as unclassified_spend,

  -- Redefined: only capex consumes the envelope. This is the line that made
  -- Q004 report a −71.019 overrun that did not exist.
  coalesce(b.total_budget, 0)
    - coalesce(sum(a.gross_amount) filter (where a.direction='expense' and a.treatment='capex' and a.status in ('paid','pending','scheduled')), 0)
    as remaining_budget
from projects p
left join actual a on a.project_id = p.id
left join lateral (
  select sum(bl.amount) as total_budget
  from project_budgets pb join budget_lines bl on bl.budget_id = pb.id
  where pb.project_id = p.id and pb.is_current
) b on true
group by p.id, p.org_id, p.code, p.display_name, p.status, p.business_model, b.total_budget;

-- Layer 3: detection. Both join the existing /quality page for free.
create view v_qc_spend_without_treatment as
select t.id as transaction_id, t.org_id, t.project_id, t.tx_date,
       t.gross_amount, t.description, p.display_name as project_name
from transactions t
join projects p on p.id = t.project_id
left join categories c on c.id = t.category_id
where t.status <> 'cancelled'
  and t.direction = 'expense'
  and (t.category_id is null or c.cost_treatment is null);

create view v_qc_capex_to_lessor as
select t.id as transaction_id, t.org_id, t.project_id, t.tx_date,
       t.gross_amount, ct.name as contact_name, p.display_name as project_name
from transactions t
join projects p on p.id = t.project_id
join categories c on c.id = t.category_id
join contacts ct on ct.id = t.contact_id
join installment_plans ip on ip.project_id = t.project_id
  and ip.obligation_kind in ('rent', 'third_party_tax_settlement')
  and ip.contact_id = t.contact_id
where t.status <> 'cancelled'
  and t.direction = 'expense'
  and c.cost_treatment = 'capex';

comment on view v_qc_capex_to_lessor is
  'Capex-treated spend paid to a counterparty who is also the lessor on a rent '
  'or settlement plan for the same project -- the shape of the Q004 error.';
