-- 0089: «Ορισμός ως βάση» -- make one scenario the project's base.
--
-- A project may have any number of scenarios (0021), at most one of them
-- the base (project_scenarios_one_base_uq, partial unique on is_base).
-- Moving the flag from the app would take two writes and could leave a
-- project with no base, or trip the index, if the second write failed.
--
-- set_base_scenario() does it in one call: it clears the old base and then
-- sets the new one, in that order (a non-deferrable unique index is
-- checked row by row, so setting first would collide with the old base),
-- inside the function's single transaction. Either both happen or neither.
--
-- SECURITY INVOKER: the writes run under the caller's own RLS
-- (project_scenarios_update = has_role(org_id, 'editor')). A viewer's or
-- another org's call updates nothing, and the function then raises rather
-- than report a silent success.

create function public.set_base_scenario(p_scenario uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_org uuid;
  v_project uuid;
begin
  select org_id, project_id into v_org, v_project
  from project_scenarios where id = p_scenario;
  if v_project is null then
    raise exception 'scenario not found' using errcode = 'P0002';
  end if;

  update project_scenarios set is_base = false
  where org_id = v_org and project_id = v_project and is_base and id <> p_scenario;

  update project_scenarios set is_base = true where id = p_scenario;
  if not found then
    raise exception 'not allowed to change this project''s scenarios' using errcode = '42501';
  end if;
end;
$$;

comment on function public.set_base_scenario(uuid) is
  'Makes p_scenario its project''s only base scenario (clears the old base first). Security invoker: editor and up.';

revoke execute on function public.set_base_scenario(uuid) from public, anon;
grant execute on function public.set_base_scenario(uuid) to authenticated;
