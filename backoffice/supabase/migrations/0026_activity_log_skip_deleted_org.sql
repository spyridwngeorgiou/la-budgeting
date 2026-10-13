-- 0026: deleting a whole org cascades to its rows, and log_activity() (0024)
-- tried to log each of those deletes against the org being deleted -- a
-- foreign-key violation that blocked the delete. Skip logging when the row's
-- org no longer exists; the org's own deletion is the event that matters.

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid := (coalesce(v_new, v_old) ->> 'org_id')::uuid;
  v_uid uuid := auth.uid();
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_changes jsonb;
  v_email text;
  k text;
begin
  if v_org is null or not exists (select 1 from orgs where id = v_org) then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'search_key', 'signed_amount', 'month_key', 'fingerprint')
         and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  end if;

  if v_uid is not null then
    select email into v_email from auth.users where id = v_uid;
  else
    v_email := v_headers ->> 'x-actor-email';
  end if;

  insert into activity_log (org_id, actor_id, actor_email, via, action, entity, entity_id, project_id, label, changes)
  values (
    v_org,
    v_uid,
    v_email,
    case when v_uid is not null then 'app' when v_email is not null then 'claude' else 'system' end,
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    case when tg_table_name = 'projects' then (v_row ->> 'id')::uuid else (v_row ->> 'project_id')::uuid end,
    coalesce(v_row ->> 'description', v_row ->> 'label', v_row ->> 'title', v_row ->> 'name',
             v_row ->> 'display_name', v_row ->> 'lender', v_row ->> 'source', v_row ->> 'body'),
    v_changes
  );
  return null;
end;
$$;
