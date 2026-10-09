-- 0036: views respect RLS; plan RPCs check the caller's role
--
-- 0012 claimed "Views inherit RLS ... automatically". They don't: a plain
-- `create view` runs with its owner's privileges, so every view from 0011,
-- 0016, 0020, 0021 and 0034 bypassed the policies on transactions/accounts/
-- projects and returned every org's rows to any signed-in user. 0028+ views
-- already set security_invoker; this brings the rest in line, and the guard
-- at the bottom keeps a future `create view` from regressing it.
--
-- Required before any user outside an org (external project partners) can
-- hold an account at all.

do $$
declare
  v record;
begin
  for v in select schemaname, viewname from pg_views where schemaname = 'public' loop
    execute format('alter view %I.%I set (security_invoker = true)', v.schemaname, v.viewname);
  end loop;
end $$;

-- regenerate_plan() is SECURITY DEFINER (it must write generated rows past
-- per-row checks) but never checked who was calling it: any signed-in user
-- could regenerate any org's plan by id. Keep the body as-is under an
-- internal name nobody can call directly, and front it with a guarded
-- wrapper under the original name so the app's rpc() call and
-- ensure_plans_current() keep working unchanged.
alter function public.regenerate_plan(uuid) rename to regenerate_plan_unchecked;
revoke execute on function public.regenerate_plan_unchecked(uuid) from public, anon, authenticated;

create function public.regenerate_plan(p_plan_id uuid) returns table(
  generated_count int, protected_count int
) language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from installment_plans where id = p_plan_id;
  if not found then
    raise exception 'installment_plans % not found', p_plan_id;
  end if;
  -- auth.uid() is null only for trusted callers with no JWT: pg_cron via
  -- ensure_plans_current(), or a direct postgres/service-role session.
  if auth.uid() is not null and not has_role(v_org, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from regenerate_plan_unchecked(p_plan_id);
end;
$$;
revoke execute on function public.regenerate_plan(uuid) from public, anon;
grant execute on function public.regenerate_plan(uuid) to authenticated;

-- ensure_plans_current(null) rolls every org's plans forward. Only the
-- nightly cron (runs as postgres) calls it; nothing in the app does.
revoke execute on function public.ensure_plans_current(uuid) from public, anon, authenticated;

-- Fail the migration if any public view still runs with owner rights.
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)
  ) then
    raise exception 'public view without security_invoker';
  end if;
end $$;
