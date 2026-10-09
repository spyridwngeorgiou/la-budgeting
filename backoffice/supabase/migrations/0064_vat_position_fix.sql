-- 0064: VAT position -- correct credit carry-forward, locked filed periods,
-- quarterly regime.
--
-- 1. Carry-forward. 0011 computed credit = min(0, S) and payable from S
--    (S = running sum of net VAT). That treats VAT already paid as if it were
--    still available to offset a later credit: nets +50, -100, +80 gave
--    payables 50/0/30. The tax office does not refund the 50 paid in month 1;
--    month 2 opens a 100 credit which month 3 consumes to 20. With
--    M = max(0, running max of S):
--        payable_n = M_n - M_(n-1)        credit_n = S_n - M_n   (<= 0)
--    which gives 50/0/0 with a remaining credit of -20. The recursion it
--    replaces -- payable_n = max(0, net_n + credit_(n-1)), credit_n =
--    min(0, net_n + credit_(n-1)) -- produces exactly these figures; the 0011
--    comment's worked examples (no payment before the first credit) are
--    unchanged.
-- 2. Locked periods. Once a period is filed, its figures are what was
--    submitted: vat_periods.locked_vat_income/expense (0007) replace the live
--    sums, so a backdated invoice cannot silently rewrite a filed return.
--    It moves into the next open period instead -- see the note on `base`.
-- 3. Quarterly. orgs.settings->>'vat_period' = 'quarterly' (απλογραφικά
--    βιβλία) buckets by calendar quarter, with the filing deadline at the end
--    of the month after the quarter.

create function public.vat_filing_deadline(p_period_start date, p_period_months int) returns date
language sql immutable parallel safe as $$
  select (date_trunc('month', p_period_start::timestamp) + make_interval(months => p_period_months + 1)
          - interval '1 day')::date
$$;

-- 1 for monthly (default), 3 for quarterly. stable: reads the org row.
create function public.vat_period_months(p_org uuid) returns int
language sql stable as $$
  select case when o.settings->>'vat_period' = 'quarterly' then 3 else 1 end
  from orgs o where o.id = p_org
$$;

-- Same eight leading columns as 0011/0042 (create or replace requires it);
-- is_locked and period_months appended.
--
-- A filed period keeps its snapshot; any later difference between the live
-- ledger and that snapshot (an invoice entered after filing, dated inside the
-- filed period) is carried into the first open period after it, which is
-- where it would actually be declared.
create or replace view v_vat_position with (security_invoker = true) as
with tx as (
  select t.org_id,
         (case when o.settings->>'vat_period' = 'quarterly'
               then date_trunc('quarter', t.tx_date::timestamp)
               else date_trunc('month', t.tx_date::timestamp) end)::date as period_start,
         case when o.settings->>'vat_period' = 'quarterly' then 3 else 1 end as period_months,
         t.direction, t.vat_amount
  from transactions t
  join orgs o on o.id = t.org_id
  where t.scope = 'business' and t.status <> 'cancelled'
), live as (
  select org_id, period_start, max(period_months) as period_months,
         coalesce(sum(vat_amount) filter (where direction = 'income'), 0)  as vat_income,
         coalesce(sum(vat_amount) filter (where direction = 'expense'), 0) as vat_expense
  from tx
  group by org_id, period_start
), base as (
  select l.org_id, l.period_start, l.period_months,
         coalesce(vp.locked, false) as is_locked,
         case when coalesce(vp.locked, false) then coalesce(vp.locked_vat_income, l.vat_income) else l.vat_income end as vat_income,
         case when coalesce(vp.locked, false) then coalesce(vp.locked_vat_expense, l.vat_expense) else l.vat_expense end as vat_expense,
         -- what the ledger says now minus what was filed: non-zero only for locked periods
         case when coalesce(vp.locked, false)
              then (l.vat_income - l.vat_expense)
                   - (coalesce(vp.locked_vat_income, l.vat_income) - coalesce(vp.locked_vat_expense, l.vat_expense))
              else 0 end as late_delta
  from live l
  left join vat_periods vp on vp.org_id = l.org_id and vp.period_start = l.period_start
), carried as (
  -- each locked period's late delta lands on the first open period after it
  select b.*,
         coalesce((
           select sum(x.late_delta) from base x
           where x.org_id = b.org_id and x.is_locked and x.late_delta <> 0
             and x.period_start < b.period_start
             and not exists (
               select 1 from base y
               where y.org_id = b.org_id and not y.is_locked
                 and y.period_start > x.period_start and y.period_start < b.period_start)
         ), 0) as carried_in
  from base b
), net as (
  select c.*,
         c.vat_income - c.vat_expense + case when c.is_locked then 0 else c.carried_in end as net_position
  from carried c
), running as (
  select n.*,
         sum(n.net_position) over w as s,
         greatest(0, max(sum_to_here) over w) as m
  from (select n.*, sum(n.net_position) over (partition by n.org_id order by n.period_start
                                              rows between unbounded preceding and current row) as sum_to_here
        from net n) n
  window w as (partition by n.org_id order by n.period_start rows between unbounded preceding and current row)
)
select org_id, period_start, vat_income, vat_expense, net_position,
       s - m as credit_balance,
       m - coalesce(lag(m) over (partition by org_id order by period_start), 0) as payable_after_credit,
       vat_filing_deadline(period_start, period_months) as filing_deadline,
       is_locked,
       period_months
from running;

comment on view v_vat_position is
  'One row per VAT period with activity (monthly, or quarterly when '
  'orgs.settings.vat_period = quarterly). credit_balance <= 0 is the credit '
  'carried forward; payable_after_credit is what this period adds to the '
  'amount owed. Filed (locked) periods show their snapshot; later changes '
  'inside them roll into the next open period.';
