-- 0005: installment plan generation
-- installment_plans table itself lives in 0004 (transactions.plan_id needs the FK).
--
-- Design: a plan header + one real transactions row per installment, not a
-- single row with derived columns. The workbook's single-row approach needs a
-- 90-line SUMIFS/SUMPRODUCT helper (_recur_monthly) to answer "what's due this
-- month", cannot represent a late/partial/skipped payment, and assumes paid
-- installments are contiguous. Materialising trades ~450 rows (irrelevant at
-- this scale) for every downstream query becoming a plain indexed date filter.

create or replace function public.regenerate_plan(p_plan_id uuid) returns table(
  generated_count int, protected_count int
) language plpgsql security definer set search_path = public as $$
declare
  v_plan installment_plans%rowtype;
  v_n int;
  v_k int;
  v_due date;
  v_amount numeric(14,2);
  v_vat numeric(14,2);
  v_generated int := 0;
  v_protected int := 0;
begin
  select * into v_plan from installment_plans where id = p_plan_id for update;
  if not found then
    raise exception 'installment_plans % not found', p_plan_id;
  end if;

  v_n := coalesce(v_plan.installment_count, v_plan.horizon_months);
  if v_plan.end_date is not null then
    -- bound by end_date if it caps the count sooner
    v_n := least(v_n, (
      extract(year from age(v_plan.end_date, v_plan.first_due_date))::int * 12
      + extract(month from age(v_plan.end_date, v_plan.first_due_date))::int
      + 1
    ));
  end if;

  for v_k in 1..v_n loop
    v_due := case v_plan.frequency
      when 'monthly'     then (v_plan.first_due_date + make_interval(months => v_k - 1))
      when 'quarterly'   then (v_plan.first_due_date + make_interval(months => (v_k - 1) * 3))
      when 'semiannual'  then (v_plan.first_due_date + make_interval(months => (v_k - 1) * 6))
      when 'annual'      then (v_plan.first_due_date + make_interval(years  => v_k - 1))
    end;
    -- snap to the last valid day of the target month so a 31st-of-month plan
    -- doesn't skip February
    v_due := least(v_due, (date_trunc('month', v_due) + interval '1 month - 1 day')::date);

    v_amount := round(v_plan.amount_per_installment * power(1 + v_plan.escalation_pct,
                  floor((v_k - 1) / 12.0)), 2);
    v_vat := round(coalesce(v_plan.vat_per_installment, 0) * power(1 + v_plan.escalation_pct,
                  floor((v_k - 1) / 12.0)), 2);

    -- Protected: never touch a row that is paid, invoiced, or has a document —
    -- those are historical fact, not a projection to regenerate.
    if exists (
      select 1 from transactions t
      where t.plan_id = p_plan_id and t.installment_no = v_k
        and (t.status = 'paid' or t.paid_on is not null
             or t.mydata_mark is not null or t.source_document_id is not null)
    ) then
      v_protected := v_protected + 1;
      continue;
    end if;

    insert into transactions (
      org_id, tx_date, due_date, contact_id, project_id, category_id, account_id,
      direction, scope, status, origin,
      gross_amount, net_amount, vat_amount, vat_rate, withholding_amount,
      has_invoice, description, plan_id, installment_no
    ) values (
      v_plan.org_id, v_due, v_due, v_plan.contact_id, v_plan.project_id,
      v_plan.category_id, v_plan.account_id,
      v_plan.direction, v_plan.scope, 'scheduled', 'manual',
      v_amount + v_vat - v_plan.withholding_per_installment, v_amount, v_vat,
      v_plan.vat_rate, v_plan.withholding_per_installment,
      v_plan.vat_rate is not null and v_plan.vat_rate > 0,
      v_plan.label || ' — δόση ' || v_k::text || '/' || coalesce(v_n::text, '?'),
      p_plan_id, v_k
    )
    on conflict (plan_id, installment_no) where plan_id is not null
    do update set
      tx_date = excluded.tx_date, due_date = excluded.due_date,
      gross_amount = excluded.gross_amount, net_amount = excluded.net_amount,
      vat_amount = excluded.vat_amount, withholding_amount = excluded.withholding_amount;

    v_generated := v_generated + 1;
  end loop;

  update installment_plans set generated_through =
    (select max(tx_date) from transactions where plan_id = p_plan_id)
    where id = p_plan_id;

  return query select v_generated, v_protected;
end;
$$;

-- Nightly roll-forward for indefinite plans (installment_count is null), plus
-- a cheap self-heal called from the dashboard loader so a paused-then-resumed
-- project catches up without waiting for the cron.
create or replace function public.ensure_plans_current(p_org_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_plan record;
begin
  for v_plan in
    select id from installment_plans
    where status = 'active' and installment_count is null
      and (p_org_id is null or org_id = p_org_id)
      and (generated_through is null
           or generated_through < current_date + make_interval(months => horizon_months) / 2)
  loop
    perform regenerate_plan(v_plan.id);
  end loop;
end;
$$;

-- Auto-complete a plan once every installment is paid.
create or replace function public.check_plan_completion() returns trigger
language plpgsql as $$
begin
  if new.plan_id is not null and new.status = 'paid' then
    update installment_plans p set status = 'completed'
    where p.id = new.plan_id and p.installment_count is not null
      and not exists (
        select 1 from transactions t
        where t.plan_id = p.id and t.status <> 'paid'
      );
  end if;
  return new;
end;
$$;

create trigger transactions_plan_completion
  after insert or update of status on transactions
  for each row when (new.plan_id is not null)
  execute function check_plan_completion();
