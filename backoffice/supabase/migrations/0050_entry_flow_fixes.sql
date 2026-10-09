-- 0050: entry-flow fixes that the unified ingestion work (0051+) builds on.
--
-- 1. find_possible_duplicates(): the manual form and the draft review screen
--    had no duplicate guard at all -- only the AADE importer did (stageBatch).
--    Typing the same supplier invoice twice, or approving a photo of a bill
--    that was already entered by hand, went straight into the ledger.
-- 2. v_account_balances ignored paid_on: a payment recorded today with a
--    paid_on next week already counted in "current balance", while
--    account_balance_as_of (0031) -- used by every balance check -- did not.
--    The two numbers disagreed for exactly the rows people look at most.
-- 3. aade_staging_rows.commit_error: commitBatch skipped a failing row with a
--    bare `continue`, so the batch said «Ολοκληρώθηκε» while rows were
--    silently missing from the ledger.

-- Possible duplicates of a transaction about to be written. Deliberately
-- loose -- it only feeds a «Πιθανό διπλότυπο» warning the user can override,
-- never a block -- so it errs towards showing a candidate:
--   * same invoice number (case/space-insensitive) for the same party, or
--   * same direction and amount (to the cent) within ±p_days of the date,
--     where the parties agree or one side has no party recorded at all
--     (a cash row typed without a contact still collides with the invoice).
-- security invoker: RLS decides what the caller may see, and p_org narrows
-- it further for users who belong to several orgs.
create function public.find_possible_duplicates(
  p_org uuid,
  p_direction tx_direction,
  p_gross numeric,
  p_tx_date date,
  p_contact uuid default null,
  p_counterparty_afm text default null,
  p_invoice_number text default null,
  p_exclude uuid default null,
  p_days int default 3
) returns table (
  id uuid,
  tx_date date,
  gross_amount numeric,
  status tx_status,
  counterparty_name text,
  contact_name text,
  invoice_number text,
  description text,
  reason text
)
language sql stable security invoker set search_path = public as $$
  with input as (
    select nullif(upper(regexp_replace(coalesce(p_invoice_number, ''), '\s+', '', 'g')), '') as inv,
           nullif(p_counterparty_afm, '') as afm
  )
  select t.id, t.tx_date, t.gross_amount, t.status, t.counterparty_name, c.name, t.invoice_number, t.description,
         case
           when i.inv is not null
            and upper(regexp_replace(coalesce(t.invoice_number, ''), '\s+', '', 'g')) = i.inv then 'invoice_number'
           else 'amount_date'
         end as reason
  from transactions t
  cross join input i
  left join contacts c on c.id = t.contact_id
  where t.org_id = p_org
    and t.status <> 'cancelled'
    and (p_exclude is null or t.id <> p_exclude)
    and (
      -- same document number for the same party (or with no party on either side)
      (i.inv is not null
       and upper(regexp_replace(coalesce(t.invoice_number, ''), '\s+', '', 'g')) = i.inv
       and (
         (p_contact is not null and t.contact_id = p_contact)
         or (i.afm is not null and t.counterparty_afm = i.afm)
         or (p_contact is null and i.afm is null)
         or (t.contact_id is null and t.counterparty_afm is null)
       ))
      or
      -- same money, same direction, a few days apart, parties not contradicting
      (t.direction = p_direction
       and t.gross_amount = round(p_gross, 2)
       and abs(t.tx_date - p_tx_date) <= p_days
       and (
         (p_contact is null and i.afm is null)
         or (t.contact_id is null and t.counterparty_afm is null)
         or (p_contact is not null and t.contact_id = p_contact)
         or (i.afm is not null and t.counterparty_afm = i.afm)
       ))
    )
  order by (case when i.inv is not null
                  and upper(regexp_replace(coalesce(t.invoice_number, ''), '\s+', '', 'g')) = i.inv
             then 0 else 1 end),
           abs(t.tx_date - p_tx_date), t.created_at desc
  limit 5
$$;
revoke execute on function public.find_possible_duplicates(uuid, tx_direction, numeric, date, uuid, text, text, uuid, int) from public, anon;
grant execute on function public.find_possible_duplicates(uuid, tx_direction, numeric, date, uuid, text, text, uuid, int) to authenticated;

-- Same rule as account_balance_as_of(account, current_date): a paid row
-- counts from its payment date (falling back to tx_date), so a payment
-- post-dated to next week is not in hand yet. projected_balance adds what is
-- still open on the account (pending + scheduled, and paid-but-future), i.e.
-- where the balance lands once everything already booked against it clears.
--
-- `create or replace` keeps the leading columns identical, so the dependent
-- views (v_net_worth 0011, v_qc_account_drift 0035) are untouched; the new
-- column is appended at the end, which is the only change Postgres allows.
create or replace view v_account_balances with (security_invoker = true) as
select
  a.id as account_id, a.org_id, a.name, a.kind, a.owner_scope, a.is_liquid,
  a.opening_balance, a.opening_balance_date,
  a.opening_balance + coalesce(sum(t.signed_amount) filter (
    where t.status = 'paid'
      and t.tx_date >= a.opening_balance_date
      and coalesce(t.paid_on, t.tx_date) <= current_date
  ), 0) as current_balance,
  a.opening_balance + coalesce(sum(t.signed_amount) filter (
    where t.status in ('paid', 'pending', 'scheduled')
      and t.tx_date >= a.opening_balance_date
  ), 0) as projected_balance
from accounts a
left join transactions t on t.account_id = a.id and t.org_id = a.org_id
group by a.id, a.org_id, a.name, a.kind, a.owner_scope, a.is_liquid,
         a.opening_balance, a.opening_balance_date;

-- Why a staged AADE row did not make it into the ledger on the last commit
-- attempt. Cleared when the row commits; shown on the batch review page.
alter table aade_staging_rows add column commit_error text;
