-- The monthly cost and billing frequency of each utility, from the
-- «Πάγια» / «Ακίνητα & Παροχές» sheets of the 184 workbook
-- (scripts/sync-workbook.mjs writes them when these columns exist).
-- Additive and nullable: nothing existing changes.
alter table property_utilities
  add column if not exists monthly_amount numeric(14,2)
    check (monthly_amount is null or monthly_amount >= 0),
  add column if not exists billing_frequency plan_frequency;
