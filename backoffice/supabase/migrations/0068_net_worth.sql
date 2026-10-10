-- 0068: net worth -- what we own minus what we owe, today.
--
-- v_net_worth (0011) summed every account (gold included, as "liquid"),
-- held assets and every liability not yet repaid -- including loans still
-- in application, which are not debt yet -- and knew nothing of open
-- receivables/payables, bank loans or VAT. It is rebuilt here over one
-- itemised view, so the page can list exactly what makes up each total and
-- the totals can never disagree with the items.
--
-- v_net_worth_items.amount is signed: + what we own, - what we owe.
--   cash            liquid account balances (v_liquidity)
--   other_accounts  non-liquid accounts: gold, crypto...
--   assets          assets held, at estimated value × ownership share
--                   (pending inheritances are listed elsewhere, never summed)
--   receivables     pending income: invoiced / agreed, not yet collected
--   payables        pending expenses: owed to suppliers now
--   liabilities     private loans and other obligations already received
--   loans           bank loans: drawn so far minus principal repaid
--   vat             credit carried forward (+) minus payable not yet paid (-)
-- Scheduled rows are future commitments, not today's position: they are
-- in the cash forecast, not here.

create view v_net_worth_items with (security_invoker = true) as
select l.org_id, 'cash'::text as component, l.owner_scope, null::uuid as ref_id,
       null::text as label, l.balance as amount
from v_liquidity l

union all
select b.org_id, 'other_accounts', b.owner_scope, b.account_id, b.name, b.current_balance
from v_account_balances b
where not b.is_liquid

union all
select a.org_id, 'assets', a.owner_scope, a.id, a.name, round(a.estimated_value * a.ownership_pct, 2)
from assets a
where a.state = 'held'

union all
select t.org_id, case when t.direction = 'income' then 'receivables' else 'payables' end,
       coalesce(ac.owner_scope, case when t.scope = 'personal' then 'personal' else 'corporate' end::owner_scope),
       t.id, coalesce(nullif(btrim(t.description), ''), t.counterparty_name),
       case when t.direction = 'income' then t.gross_amount else -t.gross_amount end
from transactions t
left join accounts ac on ac.id = t.account_id
where t.status = 'pending'
  -- a pending loan instalment is already inside the loan balance below
  and t.loan_id is null

union all
select li.org_id, 'liabilities', li.owner_scope, li.id, li.lender, -li.principal
from liabilities li
where li.state = 'disbursed'

union all
select ln.org_id, 'loans', 'corporate'::owner_scope, ln.id, ln.label,
       -greatest(0, coalesce(d.drawn, 0) - coalesce(r.repaid, 0))
from loans ln
left join lateral (
  select sum(coalesce(dd.actual_amount, dd.amount)) as drawn
  from loan_drawdowns dd
  where dd.loan_id = ln.id
    and (dd.actual_date is not null
         or (ln.state = 'disbursed' and dd.scheduled_month <= athens_today()))
) d on true
left join lateral (
  select sum(t.gross_amount - coalesce(t.interest_amount, 0)) as repaid
  from transactions t
  where t.loan_id = ln.id and t.status = 'paid' and t.direction = 'expense'
) r on true
where ln.state in ('approved', 'disbursed')

union all
select v.org_id, 'vat', 'corporate'::owner_scope, null::uuid, null::text,
       -- credit still carried at the latest period so far ...
       coalesce((select -x.credit_balance from v_vat_position x
                 where x.org_id = v.org_id and x.period_start <= athens_today()
                 order by x.period_start desc limit 1), 0)
       -- ... minus what is payable and not yet paid (deadline not yet past,
       -- same rule as the cash forecast)
       - coalesce((select sum(x.payable_after_credit) from v_vat_position x
                   left join vat_periods vp on vp.org_id = x.org_id and vp.period_start = x.period_start
                   where x.org_id = v.org_id and x.period_start <= athens_today()
                     and x.filing_deadline >= date_trunc('month', athens_today()::timestamp)::date
                     and not coalesce(vp.status = 'paid' or vp.paid_on is not null, false)), 0)
from (select distinct org_id from v_vat_position) v;

-- Same four leading columns as 0011, with today's meaning:
--   liquid_total     every account balance (cash + other_accounts), as before
--   asset_total      held assets × ownership share, as before
--   liability_total  liabilities actually received (state disbursed) -- an
--                    application or an approval is not debt yet
-- then the new parts and the total, all positive magnitudes except vat_total
-- (signed) and net_worth.
create or replace view v_net_worth with (security_invoker = true) as
select o.id as org_id,
       coalesce(sum(i.amount) filter (where i.component in ('cash', 'other_accounts')), 0) as liquid_total,
       coalesce(sum(i.amount) filter (where i.component = 'assets'), 0) as asset_total,
       coalesce(-sum(i.amount) filter (where i.component = 'liabilities'), 0) as liability_total,
       coalesce(sum(i.amount) filter (where i.component = 'cash'), 0) as cash_total,
       coalesce(sum(i.amount) filter (where i.component = 'other_accounts'), 0) as other_accounts_total,
       coalesce(sum(i.amount) filter (where i.component = 'receivables'), 0) as receivables_total,
       coalesce(-sum(i.amount) filter (where i.component = 'payables'), 0) as payables_total,
       coalesce(-sum(i.amount) filter (where i.component = 'loans'), 0) as loans_total,
       coalesce(sum(i.amount) filter (where i.component = 'vat'), 0) as vat_total,
       coalesce(sum(i.amount), 0) as net_worth
from orgs o
left join v_net_worth_items i on i.org_id = o.id
group by o.id;
