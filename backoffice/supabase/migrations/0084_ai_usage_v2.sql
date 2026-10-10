-- 0084: AI spend, counted in SQL and per model call.
--
-- assertWithinAiBudget() used to fetch this month's ai_usage rows and sum
-- them in JS -- PostgREST caps a response at 1000 rows, so a busy month
-- silently under-counted and the budget never tripped. ai_budget_check()
-- sums in the database instead.
--
-- The chat route now logs every model call of its tool loop (not only the
-- last one) and prices prompt-cache reads and writes, so ai_usage gains
-- cache_write_tokens and the conversation the call belonged to.

alter table ai_usage add column cache_write_tokens int;
alter table ai_usage add column conversation_id uuid references ai_conversations(id) on delete set null;
create index ai_usage_org_created_idx on ai_usage (org_id, created_at) include (cost_cents);

-- Viewers may use the assistant, so they must be able to record what it
-- cost (0012 allowed only editors to insert, and a viewer's chat went
-- unmetered). Only rows for themselves, and never a collab row: those go
-- through log_collab_ai_usage() (0059).
create policy ai_usage_insert_self on ai_usage for insert
  with check (user_id = auth.uid() and project_id is null and has_role(org_id, 'viewer'));

-- This month's spend and cap for one org. SECURITY INVOKER: a member sees
-- their org's rows through RLS (0012: viewer and up); anyone else sums
-- nothing. The service-role client (email inbound) sees everything.
-- p_default_monthly_cents is the deployment default
-- (AI_MONTHLY_BUDGET_CENTS); orgs.settings.ai_monthly_budget_cents wins,
-- exactly as in lib/ai/client.ts monthlyBudgetCents().
create function public.ai_budget_check(p_org uuid, p_default_monthly_cents numeric)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with cap as (
    select case
             when o.settings ->> 'ai_monthly_budget_cents' ~ '^[0-9]+(\.[0-9]+)?$'
                  and (o.settings ->> 'ai_monthly_budget_cents')::numeric > 0
               then (o.settings ->> 'ai_monthly_budget_cents')::numeric
             else greatest(coalesce(p_default_monthly_cents, 0), 0)
           end as cents
    from (select 1) one
    left join orgs o on o.id = p_org
  ), spent as (
    select coalesce(sum(u.cost_cents), 0) as cents
    from ai_usage u
    where u.org_id = p_org
      and u.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
  )
  select jsonb_build_object('spent_cents', spent.cents, 'cap_cents', cap.cents)
  from cap, spent;
$$;

revoke execute on function public.ai_budget_check(uuid, numeric) from public, anon;
grant execute on function public.ai_budget_check(uuid, numeric) to authenticated, service_role;
