-- 0016: enrich the v_qc_* data-quality views with human-readable context
-- (contact name, description, amounts) instead of bare ids, so the Έλεγχοι
-- Ποιότητας page can render business-language rows without N+1 lookups.
-- CREATE OR REPLACE VIEW keeps every original column in place and only
-- appends new ones, so nothing that already depended on these views breaks.

create or replace view v_qc_duplicate_invoice_numbers as
select t.org_id, t.invoice_number, array_agg(t.id) as transaction_ids, count(*) as n,
       array_agg(t.tx_date order by t.tx_date) as tx_dates,
       array_agg(coalesce(c.name, t.counterparty_name) order by t.tx_date) as contact_names,
       array_agg(t.gross_amount order by t.tx_date) as amounts
from transactions t
left join contacts c on c.id = t.contact_id
where t.invoice_number is not null and t.invoice_number <> ''
group by t.org_id, t.invoice_number having count(*) > 1;

create or replace view v_qc_missing_project_or_account as
select t.id as transaction_id, t.org_id, t.tx_date, t.description,
       coalesce(c.name, t.counterparty_name) as contact_name, t.gross_amount,
       (t.project_id is null) as missing_project, (t.account_id is null) as missing_account
from transactions t
left join contacts c on c.id = t.contact_id
where (t.project_id is null or t.account_id is null) and t.status <> 'cancelled';

create or replace view v_qc_vat_mismatch as
select t.id as transaction_id, t.org_id, t.tx_date, t.net_amount, t.vat_amount, t.vat_rate,
       round(t.net_amount * t.vat_rate, 2) as expected_vat,
       t.description, coalesce(c.name, t.counterparty_name) as contact_name
from transactions t
left join contacts c on c.id = t.contact_id
where t.vat_rate is not null and t.net_amount is not null
  and abs(t.vat_amount - round(t.net_amount * t.vat_rate, 2)) > 0.02;

create or replace view v_qc_amount_identity_mismatch as
select t.id as transaction_id, t.org_id, t.tx_date,
       t.net_amount + t.vat_amount - t.withholding_amount as expected_gross, t.gross_amount,
       t.description, coalesce(c.name, t.counterparty_name) as contact_name
from transactions t
left join contacts c on c.id = t.contact_id
where t.net_amount is not null
  and abs((t.net_amount + t.vat_amount - t.withholding_amount) - t.gross_amount) > 0.02;

create or replace view v_qc_contacts_missing_afm as
select id as contact_id, org_id, name, phone, email from contacts where afm is null or afm = '';

create or replace view v_qc_duplicate_fingerprints as
select t.org_id, t.fingerprint, array_agg(t.id) as transaction_ids, count(*) as n,
       array_agg(t.tx_date order by t.tx_date) as tx_dates,
       array_agg(coalesce(c.name, t.counterparty_name) order by t.tx_date) as contact_names,
       array_agg(t.gross_amount order by t.tx_date) as amounts
from transactions t
left join contacts c on c.id = t.contact_id
where t.fingerprint is not null
group by t.org_id, t.fingerprint having count(*) > 1;

create or replace view v_qc_future_dated as
select t.id as transaction_id, t.org_id, t.tx_date, t.description, t.gross_amount,
       coalesce(c.name, t.counterparty_name) as contact_name
from transactions t
left join contacts c on c.id = t.contact_id
where t.tx_date > current_date + 2 and t.status <> 'scheduled';

create or replace view v_qc_non_positive_amounts as
select t.id as transaction_id, t.org_id, t.gross_amount, t.tx_date, t.direction, t.description,
       coalesce(c.name, t.counterparty_name) as contact_name
from transactions t
left join contacts c on c.id = t.contact_id
where t.gross_amount <= 0;

create or replace view v_qc_duplicate_contact_afm as
select org_id, afm, array_agg(id) as contact_ids, count(*) as n, array_agg(name) as contact_names
from contacts where afm is not null and afm <> ''
group by org_id, afm having count(*) > 1;

create or replace view v_qc_projects_without_budget as
select p.id as project_id, p.org_id, p.display_name, p.code
from projects p
where not exists (
  select 1 from project_budgets pb where pb.project_id = p.id and pb.is_current
);

create or replace view v_qc_afm_mismatch as
select t.id as transaction_id, t.org_id, t.counterparty_afm, c.afm as contact_afm,
       t.tx_date, t.description, c.name as contact_name
from transactions t
join contacts c on c.id = t.contact_id
where t.counterparty_afm is not null and t.counterparty_afm <> c.afm;

create or replace view v_qc_withholding_on_income as
select t.id as transaction_id, t.org_id, t.tx_date, t.withholding_amount, t.description,
       coalesce(c.name, t.counterparty_name) as contact_name
from transactions t
left join contacts c on c.id = t.contact_id
where t.direction = 'income' and t.withholding_amount > 0;
