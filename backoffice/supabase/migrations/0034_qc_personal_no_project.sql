-- 0034: personal expenses don't belong to a project.
--
-- v_qc_missing_project_or_account (0016) flagged every row without a project,
-- including personal expenses (scope = 'personal'), which by design carry no
-- project (a home's running costs go in property_project_id, 0028). With the
-- Καθημερινά rows imported that was 53 false warnings drowning the real ones.
-- A missing ACCOUNT is still a problem for personal rows, so only the project
-- half of the check is relaxed. Same columns, so no caller changes.

create or replace view v_qc_missing_project_or_account as
select t.id as transaction_id, t.org_id, t.tx_date, t.description,
       coalesce(c.name, t.counterparty_name) as contact_name, t.gross_amount,
       (t.project_id is null and t.scope = 'business') as missing_project,
       (t.account_id is null) as missing_account
from transactions t
left join contacts c on c.id = t.contact_id
where ((t.project_id is null and t.scope = 'business') or t.account_id is null)
  and t.status <> 'cancelled';
