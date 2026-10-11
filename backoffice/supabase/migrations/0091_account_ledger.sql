-- 0091: «Ανάλυση κινήσεων» of an account (/accounts/[id]), built from the
-- transactions themselves.
--
-- v_account_ledger: one row per transaction that counts in the account's
-- balance, by exactly the rule of v_account_balances.current_balance (0050,
-- with the Athens «today» of 0090): paid, dated on/after the opening balance
-- date, and with its payment date (paid_on, else tx_date) not in the future.
-- Ordered by payment date then id; running_balance = opening balance + the
-- cumulative signed amount, so the last row's running balance equals the
-- account's current balance.
--
-- Filters on account_id/org_id push down into the window (they are its
-- partition); a filter on paid_date (the page's month filter) is applied
-- after it, so the running balance of a month's rows still starts from the
-- opening balance.
--
-- v_account_ledger_monthly: the same rows summed per payment month (inflow,
-- outflow), for the page's 12-month chart without shipping every row.
--
-- security_invoker: RLS on accounts/transactions/contacts decides what the
-- caller sees (another org, or a project partner, sees nothing).

create view v_account_ledger with (security_invoker = true) as
select
  t.id as transaction_id,
  a.id as account_id,
  a.org_id,
  coalesce(t.paid_on, t.tx_date) as paid_date,
  t.tx_date,
  t.direction,
  t.scope,
  t.description,
  coalesce(c.name, t.counterparty_name) as party_name,
  t.project_id,
  t.category_id,
  t.gross_amount,
  t.signed_amount,
  a.opening_balance + sum(t.signed_amount) over (
    partition by a.id
    order by coalesce(t.paid_on, t.tx_date), t.id
    rows between unbounded preceding and current row
  ) as running_balance
from accounts a
join transactions t on t.account_id = a.id and t.org_id = a.org_id
left join contacts c on c.id = t.contact_id
where t.status = 'paid'
  and t.tx_date >= a.opening_balance_date
  and coalesce(t.paid_on, t.tx_date) <= athens_today();

create view v_account_ledger_monthly with (security_invoker = true) as
select
  account_id,
  org_id,
  to_char(paid_date, 'YYYY-MM') as month,
  coalesce(sum(signed_amount) filter (where signed_amount > 0), 0) as inflow,
  coalesce(-sum(signed_amount) filter (where signed_amount < 0), 0) as outflow,
  count(*)::int as n
from v_account_ledger
group by account_id, org_id, to_char(paid_date, 'YYYY-MM');
