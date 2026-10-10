-- 0080: exact totals for the assistant, computed in SQL.
--
-- aggregate_transactions used to fetch matching transactions and sum them
-- in JS. PostgREST returns at most 1000 rows per request, so any question
-- spanning more than that ("πόσα ξοδέψαμε φέτος;") got a silently wrong
-- answer. ai_aggregate() groups and sums in the database and returns one
-- row per group, so there is nothing to truncate.
--
-- ai_data_quality() counts the open data-quality findings (the v_qc_* views
-- behind /reports/quality) plus uncategorised / contact-less transactions,
-- so the assistant can caveat an answer ("12 κινήσεις χωρίς κατηγορία").
--
-- Both are SECURITY INVOKER: they run with the caller's RLS, so an org the
-- caller can't read contributes nothing.

create function public.ai_aggregate(
  p_org uuid,
  p_group_by text,
  p_from date default null,
  p_to date default null,
  p_direction tx_direction default null,
  p_scope tx_scope default null,
  p_status tx_status default null,
  p_project uuid default null,
  p_contact uuid default null,
  p_category uuid default null,
  p_account uuid default null
) returns table (
  group_key text,
  label text,
  n bigint,
  gross_total numeric,
  net_total numeric,
  income_gross numeric,
  expense_gross numeric
)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_group_by is null or p_group_by not in ('project', 'category', 'contact', 'account', 'month', 'direction', 'none') then
    raise exception 'ai_aggregate: unknown group_by %', p_group_by using errcode = '22023';
  end if;

  return query
  select g.k, g.l, count(*)::bigint,
         sum(t.gross_amount)::numeric,
         sum(coalesce(t.net_amount, t.gross_amount - t.vat_amount))::numeric,
         coalesce(sum(t.gross_amount) filter (where t.direction = 'income'), 0)::numeric,
         coalesce(sum(t.gross_amount) filter (where t.direction = 'expense'), 0)::numeric
  from transactions t
  left join projects p on p.id = t.project_id
  left join categories c on c.id = t.category_id
  left join contacts ct on ct.id = t.contact_id
  left join accounts a on a.id = t.account_id
  cross join lateral (
    select
      case p_group_by
        when 'project' then t.project_id::text
        when 'category' then t.category_id::text
        when 'contact' then t.contact_id::text
        when 'account' then t.account_id::text
        when 'month' then to_char(t.tx_date, 'YYYY-MM')
        when 'direction' then t.direction::text
        else 'all'
      end as k,
      case p_group_by
        when 'project' then coalesce(p.display_name, 'Χωρίς έργο')
        when 'category' then coalesce(c.name, 'Χωρίς κατηγορία')
        when 'contact' then coalesce(ct.name, t.counterparty_name, 'Χωρίς επαφή')
        when 'account' then coalesce(a.name, 'Χωρίς λογαριασμό')
        when 'month' then to_char(t.tx_date, 'YYYY-MM')
        when 'direction' then case t.direction when 'income' then 'Έσοδα' else 'Έξοδα' end
        else 'Σύνολο'
      end as l
  ) g
  where t.org_id = p_org
    and (p_status is null and t.status <> 'cancelled' or t.status = p_status)
    and (p_from is null or t.tx_date >= p_from)
    and (p_to is null or t.tx_date <= p_to)
    and (p_direction is null or t.direction = p_direction)
    and (p_scope is null or t.scope = p_scope)
    and (p_project is null or t.project_id = p_project)
    and (p_contact is null or t.contact_id = p_contact)
    and (p_category is null or t.category_id = p_category)
    and (p_account is null or t.account_id = p_account)
  -- contact groups by name when there is no contact row, so k alone would
  -- merge every unlinked counterparty under one null key
  group by g.k, g.l
  order by sum(t.gross_amount) desc, g.l;
end;
$$;

create function public.ai_data_quality(p_org uuid)
returns table (check_name text, n bigint)
language plpgsql stable security invoker set search_path = public as $$
declare
  v text;
  v_n bigint;
  views text[] := array[
    'v_qc_account_drift', 'v_qc_afm_mismatch', 'v_qc_amount_identity_mismatch', 'v_qc_capex_to_lessor',
    'v_qc_contacts_missing_afm', 'v_qc_counterparty_without_contact', 'v_qc_duplicate_contact_afm',
    'v_qc_duplicate_fingerprints', 'v_qc_duplicate_invoice_numbers', 'v_qc_future_dated',
    'v_qc_missing_project_or_account', 'v_qc_non_positive_amounts', 'v_qc_projects_without_budget',
    'v_qc_spend_without_treatment', 'v_qc_uninvoiced_large_expenses', 'v_qc_vat_mismatch',
    'v_qc_withholding_on_income'
  ];
begin
  check_name := 'uncategorized_transactions';
  select count(*) into n from transactions t
   where t.org_id = p_org and t.status <> 'cancelled' and t.category_id is null;
  return next;

  check_name := 'transactions_without_contact';
  select count(*) into n from transactions t
   where t.org_id = p_org and t.status <> 'cancelled' and t.contact_id is null;
  return next;

  foreach v in array views loop
    -- A view another workstream renamed or dropped must not break the
    -- assistant: it is simply not reported.
    if to_regclass('public.' || v) is null then
      continue;
    end if;
    execute format('select count(*) from %I where org_id = $1', v) into v_n using p_org;
    check_name := substr(v, 3);
    n := v_n;
    return next;
  end loop;
end;
$$;

revoke execute on function public.ai_aggregate(uuid, text, date, date, tx_direction, tx_scope, tx_status, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.ai_aggregate(uuid, text, date, date, tx_direction, tx_scope, tx_status, uuid, uuid, uuid, uuid) to authenticated;
revoke execute on function public.ai_data_quality(uuid) from public, anon;
grant execute on function public.ai_data_quality(uuid) to authenticated;
