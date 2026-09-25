-- 0028: cost per property per month.
--
-- Mirrors the workbook's Πληρωμές «Κόστος ανά ακίνητο» section: rent,
-- electricity & water, internet, building fees and other running costs per
-- property, combining business rows (by project) with personal expenses
-- tagged to a property (the workbook's new Καθημερινά column «Ακίνητο»).
--
-- Personal rows get their own property_project_id rather than project_id:
-- v_project_rollup has no scope filter and treats a NULL cost_treatment as
-- capex, so a personal row in project_id would silently eat into that
-- project's development budget.

alter table transactions add column property_project_id uuid references projects(id) on delete set null;
alter table transactions add constraint tx_property_only_personal
  check (scope = 'personal' or property_project_id is null);
create index tx_property_project_idx on transactions (org_id, property_project_id)
  where property_project_id is not null;

comment on column transactions.property_project_id is
  'Which property a PERSONAL expense belongs to (home running costs). Business rows use project_id.';

-- Bucket rules, first match wins:
--   1. the text names a registered utility supply/contract/RF number (0027)
--   2. keywords (ΔΕΗ, ΕΥΔΑΠ, internet providers, κοινόχρηστα)
--   3. rent / rent-in-lieu categories
--   4. any other running cost (business opex, or a personal row tagged to a property)
-- Business development spending (capex, financing, tax) is only counted when
-- rule 1 matches -- the development budget is not a running cost.
create view v_property_monthly_cost with (security_invoker = true) as
with source as (
  select
    t.org_id,
    coalesce(t.property_project_id, t.project_id) as project_id,
    date_trunc('month', coalesce(t.paid_on, t.due_date, t.tx_date))::date as month,
    t.scope, t.status, t.gross_amount,
    c.cost_treatment,
    um.kind as utility_kind,
    translate(upper(unaccent(coalesce(t.description, '') || ' ' || coalesce(t.notes, ''))),
              'ΆΈΉΊΌΎΏΪΫ', 'ΑΕΗΙΟΥΩΙΥ') as txt
  from transactions t
  left join categories c on c.id = t.category_id
  left join lateral match_property_utility(t.org_id, coalesce(t.description, '') || ' ' || coalesce(t.notes, '')) um on true
  where t.direction = 'expense'
    and t.status <> 'cancelled'
    and (t.property_project_id is not null or (t.scope = 'business' and t.project_id is not null))
),
bucketed as (
  select *,
    case
      when utility_kind in ('electricity', 'water') then 'utilities'
      when utility_kind in ('internet', 'phone') then 'internet'
      when scope = 'business' and coalesce(cost_treatment::text, 'capex') not in ('opex', 'rent', 'rent_substitute') then null
      when txt ~ '(ΔΕΗ|ΕΥΔΑΠ|ΡΕΥΜΑ|ΗΛΕΚΤΡΙΚ|ΥΔΡΕΥΣ|PROTERGIA|ELPEDISON|ΗΡΩΝ|ΖΕΝΙΘ)' then 'utilities'
      when txt ~ '(INTERNET|COSMOTE|VODAFONE|NOVA|WIND|ΤΗΛΕΦΩΝ)' then 'internet'
      when txt ~ 'ΚΟΙΝΟΧΡΗΣΤ' then 'building_fees'
      when cost_treatment in ('rent', 'rent_substitute') then 'rent'
      else 'other'
    end as bucket
  from source
)
select
  org_id, project_id, month, bucket,
  coalesce(sum(gross_amount) filter (where status = 'paid'), 0) as paid_amount,
  coalesce(sum(gross_amount) filter (where status <> 'paid'), 0) as open_amount,
  coalesce(sum(gross_amount) filter (where status = 'paid' and scope = 'business'), 0) as business_amount,
  coalesce(sum(gross_amount) filter (where status = 'paid' and scope = 'personal'), 0) as personal_amount
from bucketed
where bucket is not null
group by org_id, project_id, month, bucket;
