-- 0029: missing-invoice tax-risk tracker.
--
-- The workbook repeatedly flags "ΧΩΡΙΣ ΠΑΡΑΣΤΑΤΙΚΟ — δαπάνη άνω των 500 €":
-- a business expense above the threshold with no invoice is not deductible
-- (lost corporate tax) and carries no recoverable input VAT; one paid in cash
-- above the threshold is not deductible even WITH an invoice. Row 110 in the
-- workbook spells the cost out: 3.000 € without an invoice loses 660 in tax
-- and 720 in VAT. These views make that exposure visible instead of living
-- in free-text notes.
--
-- Threshold and tax rate are per-org settings (orgs.settings, same place as
-- ai_monthly_budget_cents) with defaults 500 € / 22%. Both rules and rates
-- should be confirmed with the accountant; the UI says so.
--
-- Rent, rent-in-lieu, financing, taxes, VAT and pass-through never come with
-- a supplier invoice, so they are excluded rather than flagged forever.

create view v_qc_uninvoiced_large_expenses with (security_invoker = true) as
with cfg as (
  select o.id as org_id,
         coalesce((o.settings ->> 'uninvoiced_threshold_eur')::numeric, 500) as threshold,
         coalesce((o.settings ->> 'corporate_tax_rate')::numeric, 0.22) as tax_rate
  from orgs o
)
select
  t.id as transaction_id,
  t.org_id,
  t.tx_date,
  coalesce(t.paid_on, t.tx_date) as paid_on,
  t.description,
  coalesce(ct.name, t.counterparty_name) as contact_name,
  t.gross_amount,
  t.project_id,
  p.display_name as project_name,
  a.name as account_name,
  case when not t.has_invoice then 'no_invoice' else 'cash_over_limit' end as risk_kind,
  round(t.gross_amount * cfg.tax_rate, 2) as lost_deduction_est,
  case when not t.has_invoice then round(t.gross_amount * 0.24, 2) else 0 end as lost_input_vat_est
from transactions t
join cfg on cfg.org_id = t.org_id
left join categories c on c.id = t.category_id
left join accounts a on a.id = t.account_id
left join contacts ct on ct.id = t.contact_id
left join projects p on p.id = t.project_id
where t.scope = 'business'
  and t.direction = 'expense'
  and t.status = 'paid'
  and t.gross_amount > cfg.threshold
  and coalesce(c.cost_treatment::text, '') not in ('rent', 'rent_substitute', 'financing', 'tax', 'vat', 'pass_through', 'income')
  and (not t.has_invoice or a.kind = 'cash');

create view v_uninvoiced_exposure with (security_invoker = true) as
select
  org_id,
  project_id,
  project_name,
  date_trunc('month', paid_on)::date as month,
  count(*) as n,
  sum(gross_amount) as gross_amount,
  sum(lost_deduction_est) as lost_deduction_est,
  sum(lost_input_vat_est) as lost_input_vat_est
from v_qc_uninvoiced_large_expenses
group by org_id, project_id, project_name, date_trunc('month', paid_on);
