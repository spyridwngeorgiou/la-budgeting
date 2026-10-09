-- 0052: append-only audit trail for transactions.
--
-- One row per insert/update/delete, written by a trigger so no code path
-- (server action, RPC, AI write tool, regenerate_plan, cron) can skip it.
-- Who: auth.uid(). Why: the ingest batch that caused it, when the change came
-- from commit_ingest_batch / undo_ingest_batch -- they set
--   set_config('app.ingest_batch_id', <batch>, true)
--   set_config('app.ingest_source',   <source>, true)
-- for the duration of their transaction. Anything else is source 'app' (a
-- signed-in user) or 'system' (no JWT: cron, migrations, service role).
--
-- It is also how undo_ingest_batch (0055) knows a transaction was edited
-- after the import: any history row newer than the batch's commit watermark.

create table transaction_history (
  id bigint generated always as identity primary key,
  -- No FK to orgs/transactions on purpose: the trail must outlive the row it
  -- describes (a deleted transaction is exactly when you want its history),
  -- and an FK to orgs would make deleting an org fail on its own cascade.
  org_id uuid not null,
  transaction_id uuid not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  actor uuid,
  ingest_batch_id uuid,          -- FK to ingest_batches added in 0054
  source text not null,
  changed_fields text[],         -- update only; updated_at is never listed
  old_row jsonb,                 -- update/delete
  new_row jsonb,                 -- insert/update
  at timestamptz not null default now()
);
create index transaction_history_tx_idx on transaction_history (transaction_id, id desc);
create index transaction_history_batch_idx on transaction_history (ingest_batch_id) where ingest_batch_id is not null;
create index transaction_history_org_at_idx on transaction_history (org_id, at desc);

alter table transaction_history enable row level security;
-- Read like the transactions themselves. No insert/update/delete policy at
-- all: only the trigger below writes here, so the trail cannot be forged or
-- trimmed through the API.
create policy transaction_history_select on transaction_history
  for select using (has_role(org_id, 'viewer'));

-- SECURITY DEFINER is unavoidable here: the trigger runs as the editing user,
-- and that user must NOT hold an insert policy on transaction_history (or the
-- trail could be forged through the API). The function only ever inserts the
-- row describing the change that fired it -- it takes no arguments, and
-- Postgres refuses to call a trigger function outside a trigger, so it cannot
-- be used to write arbitrary rows. Listed in the reviewed allowlist in
-- supabase/tests/0036_org_isolation.test.sql.
create function public.log_transaction_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid := nullif(current_setting('app.ingest_batch_id', true), '')::uuid;
  v_source text := nullif(current_setting('app.ingest_source', true), '');
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_org uuid;
  v_id uuid;
begin
  if v_source is null then
    v_source := case when auth.uid() is null then 'system' else 'app' end;
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_org := new.org_id;
    v_id := new.id;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_org := new.org_id;
    v_id := new.id;
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and n.value is distinct from v_old -> n.key;
    -- A no-op update (e.g. a bulk "set project" that matched the old value)
    -- is not a change; recording it would also make undo think the row was
    -- touched.
    if v_changed is null then
      return null;
    end if;
  else
    v_old := to_jsonb(old);
    v_org := old.org_id;
    v_id := old.id;
    -- Deleting an org cascades into its transactions; nothing to audit for
    -- an org that no longer exists.
    if not exists (select 1 from orgs where id = v_org) then
      return null;
    end if;
  end if;

  insert into transaction_history (org_id, transaction_id, op, actor, ingest_batch_id, source, changed_fields, old_row, new_row)
  values (v_org, v_id, lower(tg_op), auth.uid(), v_batch, v_source, v_changed, v_old, v_new);
  return null;
end;
$$;

create trigger transactions_history
  after insert or update or delete on transactions
  for each row execute function log_transaction_history();

comment on table transaction_history is
  'Append-only, trigger-written. source: app | system | an ingest_source label. '
  'Feeds the «Ιστορικό» tab and undo_ingest_batch''s "edited after commit" check.';
