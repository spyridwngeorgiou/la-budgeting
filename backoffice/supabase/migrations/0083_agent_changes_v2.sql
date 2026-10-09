-- 0083: agent_changes v2 -- the assistant's proposals are applied by one
-- atomic, stale-checked database function instead of a server action.
--
-- Before: approveChange() re-read the proposal, wrote the full stored
-- `after` snapshot back over the row (clobbering anything a person changed
-- since), and flipped the status without `status = 'pending'` in the
-- filter, so two quick clicks applied the change twice.
--
-- Now:
--   * a proposal stores only the fields it changes (changed_fields; `before`
--     holds those fields' values when proposed, `after` the new values) and
--     the row's updated_at at that moment (base_updated_at);
--   * apply_agent_change() locks the proposal and the target row, refuses
--     anything not pending/conflict, and when the row moved on since the
--     proposal compares only the changed fields: a field someone else
--     changed in the meantime makes it a `conflict` (shown side by side;
--     the reviewer may force it), a change elsewhere in the row ("drift")
--     does not block and is never overwritten;
--   * which columns may ever be written is a table here
--     (agent_change_columns), kept equal to the TS ALLOWLIST by a vitest
--     parity test, so the database -- not the app -- is the boundary;
--   * a multi-step proposal is an `action` (create_revenue_plan): the model
--     never writes those tables directly any more either;
--   * the content of a proposal can't be edited after the fact, a decided
--     proposal can't be re-decided, and only apply_agent_change() can mark
--     one approved.
--
-- SECURITY INVOKER throughout: the write runs with the reviewer's own RLS
-- (editor and up), exactly like the server action it replaces.

-- ---------------------------------------------------------------------------
-- Column allowlist
-- ---------------------------------------------------------------------------
create table agent_change_columns (
  table_name text not null,
  column_name text not null,
  primary key (table_name, column_name)
);
alter table agent_change_columns enable row level security;
create policy agent_change_columns_select on agent_change_columns for select to authenticated using (true);

-- Must equal src/lib/ai/allowlist.ts ALLOWLIST[*].editableFields
-- (src/lib/ai/allowlist.test.ts parses this statement).
insert into agent_change_columns (table_name, column_name) values
  ('accounts', 'name'), ('accounts', 'opening_balance'), ('accounts', 'opening_balance_date'), ('accounts', 'iban'), ('accounts', 'notes'), ('accounts', 'is_active'),
  ('projects', 'display_name'), ('projects', 'status'), ('projects', 'phase'), ('projects', 'units'), ('projects', 'collateral_value'), ('projects', 'start_date'), ('projects', 'construction_end_date'), ('projects', 'opening_date'), ('projects', 'rent_start_date'),
  ('contacts', 'name'), ('contacts', 'afm'), ('contacts', 'kind'), ('contacts', 'phone'), ('contacts', 'email'), ('contacts', 'iban'), ('contacts', 'address'), ('contacts', 'default_vat_rate'), ('contacts', 'default_withholding_rate'), ('contacts', 'payment_terms_days'), ('contacts', 'notes'), ('contacts', 'is_active'),
  ('installment_plans', 'label'), ('installment_plans', 'amount_per_installment'), ('installment_plans', 'vat_rate'), ('installment_plans', 'withholding_per_installment'), ('installment_plans', 'escalation_pct'), ('installment_plans', 'frequency'), ('installment_plans', 'first_due_date'), ('installment_plans', 'installment_count'), ('installment_plans', 'end_date'), ('installment_plans', 'status'), ('installment_plans', 'notes'),
  ('project_notes', 'project_id'), ('project_notes', 'kind'), ('project_notes', 'severity'), ('project_notes', 'body'), ('project_notes', 'exposure_amount'), ('project_notes', 'due_date'), ('project_notes', 'resolved_at'),
  ('tasks', 'project_id'), ('tasks', 'title'), ('tasks', 'description'), ('tasks', 'status'), ('tasks', 'priority'), ('tasks', 'start_date'), ('tasks', 'due_date'),
  ('project_milestones', 'project_id'), ('project_milestones', 'title'), ('project_milestones', 'description'), ('project_milestones', 'kind'), ('project_milestones', 'due_date'), ('project_milestones', 'done_at'),
  ('loans', 'project_id'), ('loans', 'label'), ('loans', 'principal'), ('loans', 'interest_rate'), ('loans', 'term_years'), ('loans', 'grace_years'), ('loans', 'first_amortisation_month'), ('loans', 'state'), ('loans', 'notes');

-- ---------------------------------------------------------------------------
-- agent_changes columns
-- ---------------------------------------------------------------------------
alter table agent_changes
  add column base_updated_at timestamptz,
  add column changed_fields text[],
  add column action text check (action in ('create_revenue_plan')),
  add column params jsonb check (params is null or octet_length(params::text) <= 256 * 1024),
  add column conversation_id uuid references ai_conversations(id) on delete set null,
  add column conflict jsonb,
  add column error text,
  add column result jsonb,
  add column untrusted_context boolean not null default false;

alter table agent_changes drop constraint agent_change_mutation_shape;
alter table agent_changes add constraint agent_change_mutation_shape
  check (operation in ('insert', 'action') or (row_id is not null and before is not null));
alter table agent_changes add constraint agent_change_action_shape
  check ((operation = 'action') = (action is not null)
         and (operation <> 'action' or (params is not null and row_id is null and before is null)));

create index agent_changes_conversation_idx on agent_changes (conversation_id) where conversation_id is not null;

-- ---------------------------------------------------------------------------
-- Guard: content is immutable, decisions are final, approval only by apply
-- ---------------------------------------------------------------------------
create function public.agent_changes_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.org_id, new.table_name, new.row_id, new.operation, new.before, new.after, new.reason,
      new.changed_fields, new.base_updated_at, new.action, new.params, new.requested_by,
      new.created_at, new.untrusted_context)
     is distinct from
     (old.org_id, old.table_name, old.row_id, old.operation, old.before, old.after, old.reason,
      old.changed_fields, old.base_updated_at, old.action, old.params, old.requested_by,
      old.created_at, old.untrusted_context) then
    raise exception 'Το περιεχόμενο μιας πρότασης δεν αλλάζει.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     or (new.reviewed_by, new.reviewed_at, new.result, new.error, new.conflict)
        is distinct from (old.reviewed_by, old.reviewed_at, old.result, old.error, old.conflict) then
    if old.status in ('approved', 'rejected') then
      raise exception 'Αυτή η πρόταση έχει ήδη διεκπεραιωθεί.' using errcode = 'P0001';
    end if;
    if new.status = 'approved' and coalesce(current_setting('app.agent_change_apply', true), '') <> new.id::text then
      raise exception 'Μια πρόταση εγκρίνεται μόνο μέσω της εφαρμογής της.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger agent_changes_guard before update on agent_changes
  for each row execute function agent_changes_guard();

-- ---------------------------------------------------------------------------
-- apply_agent_change
-- ---------------------------------------------------------------------------
-- Returns {status: 'approved'|'conflict'|'failed', row_id?, conflict?,
-- error_code?, error?}. Raises (nothing changes) only when the proposal is
-- missing, not the caller's to decide, or already decided.
create function public.apply_agent_change(p_change uuid, p_force boolean default false)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  c agent_changes%rowtype;
  v_cols text[];
  v_fields text[];
  v_bad text[];
  v_current jsonb;
  v_conflict jsonb := '{}'::jsonb;
  v_f text;
  v_id uuid;
  v_rt record;
  v_rt_id uuid;
  v_state text;
  v_msg text;
begin
  select * into c from agent_changes where id = p_change for update;
  if not found then
    raise exception 'Η πρόταση δεν βρέθηκε ή δεν έχετε δικαίωμα έγκρισης.' using errcode = 'P0001';
  end if;
  if not has_role(c.org_id, 'editor') then
    raise exception 'Δεν έχετε δικαίωμα για αυτή την ενέργεια.' using errcode = '42501';
  end if;
  if c.status not in ('pending', 'conflict') then
    raise exception 'Αυτή η πρόταση έχει ήδη διεκπεραιωθεί.' using errcode = 'P0001';
  end if;

  begin
    -- ---- multi-step actions -------------------------------------------------
    if c.operation = 'action' then
      if c.action = 'create_revenue_plan' then
        insert into revenue_plans (org_id, name, start_year, years, created_by)
        values (c.org_id, c.params ->> 'name', (c.params ->> 'start_year')::int,
                (c.params ->> 'years')::int, coalesce(c.requested_by, auth.uid()))
        returning id into v_id;
        for v_rt in select value, ordinality from jsonb_array_elements(c.params -> 'room_types') with ordinality loop
          insert into revenue_plan_room_types (org_id, revenue_plan_id, name, unit_count, sort_order)
          values (c.org_id, v_id, v_rt.value ->> 'name', (v_rt.value ->> 'unit_count')::int, v_rt.ordinality - 1)
          returning id into v_rt_id;
          insert into revenue_plan_assumptions (org_id, room_type_id, year_number, month_number, occupancy_pct, adr)
          select c.org_id, v_rt_id, (a ->> 'year_number')::int, (a ->> 'month_number')::int,
                 (a ->> 'occupancy_pct')::numeric, (a ->> 'adr')::numeric
          from jsonb_array_elements(coalesce(v_rt.value -> 'assumptions', '[]'::jsonb)) a;
        end loop;
      else
        raise exception 'Άγνωστη ενέργεια: %', c.action using errcode = 'P0001';
      end if;

    -- ---- single-row changes on allowlisted tables -------------------------
    else
      select array_agg(column_name) into v_cols from agent_change_columns where table_name = c.table_name;
      if v_cols is null then
        raise exception 'Ο πίνακας % δεν επιτρέπεται.', c.table_name using errcode = 'P0001';
      end if;

      if c.operation = 'insert' then
        v_fields := coalesce(c.changed_fields, array(select jsonb_object_keys(c.after)));
      elsif c.operation = 'update' then
        -- Pre-0083 proposals stored the whole row: derive what actually changed.
        v_fields := coalesce(c.changed_fields, array(
          select k from jsonb_object_keys(c.after) k
          where k = any(v_cols) and (c.after -> k) is distinct from (c.before -> k)));
      else
        v_fields := '{}';
      end if;

      v_bad := array(select f from unnest(v_fields) f where not (f = any(v_cols)));
      if cardinality(v_bad) > 0 then
        raise exception 'Μη επιτρεπτό πεδίο: %', array_to_string(v_bad, ', ') using errcode = 'P0001';
      end if;
      if c.operation = 'update' and cardinality(v_fields) = 0 then
        raise exception 'Η πρόταση δεν αλλάζει κανένα πεδίο.' using errcode = 'P0001';
      end if;
      -- A project reference must stay inside the proposal's org.
      if 'project_id' = any(v_fields) and c.after ->> 'project_id' is not null
         and not exists (select 1 from projects p where p.id = (c.after ->> 'project_id')::uuid and p.org_id = c.org_id) then
        raise exception 'Το έργο δεν βρέθηκε.' using errcode = 'P0001';
      end if;

      if c.operation in ('update', 'delete') then
        execute format('select to_jsonb(t) from %I t where t.id = $1 and t.org_id = $2 for update', c.table_name)
          into v_current using c.row_id, c.org_id;
        if v_current is null then
          raise exception 'Η εγγραφή δεν υπάρχει πια.' using errcode = 'P0001';
        end if;

        -- Stale check: only when the row moved on since the proposal, and
        -- only on what this proposal touches (delete: everything it saw).
        if not p_force and (c.base_updated_at is null
             or (v_current ->> 'updated_at')::timestamptz is distinct from c.base_updated_at) then
          for v_f in
            select k from unnest(case when c.operation = 'delete'
                                      then array(select jsonb_object_keys(c.before))
                                      else v_fields end) k
            where k <> 'updated_at'
          loop
            if (c.before -> v_f) is distinct from (v_current -> v_f) then
              v_conflict := v_conflict || jsonb_build_object(v_f, jsonb_build_object(
                'before', c.before -> v_f, 'current', v_current -> v_f, 'after', c.after -> v_f));
            end if;
          end loop;
          if v_conflict <> '{}'::jsonb then
            update agent_changes set status = 'conflict', conflict = v_conflict where id = c.id;
            return jsonb_build_object('status', 'conflict', 'conflict', v_conflict);
          end if;
        end if;
      end if;

      if c.operation = 'insert' then
        if cardinality(v_fields) = 0 then
          raise exception 'Η πρόταση δεν ορίζει κανένα πεδίο.' using errcode = 'P0001';
        end if;
        execute format(
          'insert into %I (org_id, %s) select $2, %s from jsonb_populate_record(null::%I, $1) r returning id',
          c.table_name,
          (select string_agg(quote_ident(f), ', ') from unnest(v_fields) f),
          (select string_agg('r.' || quote_ident(f), ', ') from unnest(v_fields) f),
          c.table_name)
          into v_id using c.after, c.org_id;
      elsif c.operation = 'update' then
        execute format(
          'update %I t set %s from jsonb_populate_record(null::%I, $1) r where t.id = $2 and t.org_id = $3',
          c.table_name,
          (select string_agg(format('%I = r.%I', f, f), ', ') from unnest(v_fields) f),
          c.table_name)
          using c.after, c.row_id, c.org_id;
        v_id := c.row_id;
      else
        execute format('delete from %I where id = $1 and org_id = $2', c.table_name) using c.row_id, c.org_id;
        v_id := c.row_id;
      end if;
    end if;

    perform set_config('app.agent_change_apply', c.id::text, true);
    update agent_changes
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), error = null,
           result = jsonb_build_object('row_id', v_id)
     where id = c.id;
    perform set_config('app.agent_change_apply', '', true);
    return jsonb_build_object('status', 'approved', 'row_id', v_id);
  exception when others then
    -- The write above was rolled back with this block; record why.
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    update agent_changes
       set status = 'failed', error = left(v_state || ': ' || v_msg, 1000), reviewed_by = auth.uid(), reviewed_at = now()
     where id = c.id;
    return jsonb_build_object('status', 'failed', 'error_code', v_state, 'error', v_msg);
  end;
end;
$$;

revoke execute on function public.apply_agent_change(uuid, boolean) from public, anon;
grant execute on function public.apply_agent_change(uuid, boolean) to authenticated;
