-- 0085: remove the double-counted «ΣΥΝΟΛΟ ΠΡΟΣ ΙΔΙΩΤΕΣ» liability.
--
-- The original spreadsheet import brought in, next to each private loan,
-- the sheet's own total row («ΣΥΝΟΛΟ ΠΡΟΣ ΙΔΙΩΤΕΣ») as one more liability,
-- so net worth counts every private loan twice. This removes those rows --
-- but only where the row really is that total:
--
--   * per org, a liability whose lender starts with 'ΣΥΝΟΛΟ' is deleted only
--     if its principal equals the sum of that org's OTHER private
--     liabilities; any mismatch aborts the whole migration (RAISE), so a
--     real loan that happens to be named «ΣΥΝΟΛΟ…» is never lost silently;
--   * every deleted row is first copied to archive.liabilities (with when
--     and why), the plan's rule for any delete;
--   * on a fresh database (no such rows) it does nothing.
--
-- The work is a function so the pgTAP test (0085_dedupe_liability.test.sql)
-- can run it against fixtures; only the migration role can call it.

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table if not exists archive.liabilities (
  like public.liabilities including defaults,
  archived_at timestamptz not null default now(),
  archive_reason text not null
);
revoke all on archive.liabilities from public, anon, authenticated;

create or replace function archive.dedupe_liability_total() returns integer
language plpgsql
set search_path = public, archive, pg_temp
as $$
declare
  r record;
  others numeric(14,2);
  removed integer := 0;
begin
  for r in
    select id, org_id, lender, principal
    from public.liabilities
    where lender like 'ΣΥΝΟΛΟ%'
    order by org_id, id
  loop
    select coalesce(sum(principal), 0) into others
    from public.liabilities
    where org_id = r.org_id
      and kind = 'private'
      and lender not like 'ΣΥΝΟΛΟ%';

    if r.principal is distinct from others then
      raise exception
        '0085: liability % («%», org %) has principal % but the other private liabilities sum to %; not a duplicate total -- refusing to delete',
        r.id, r.lender, r.org_id, r.principal, others;
    end if;

    insert into archive.liabilities
    select l.*, now(), '0085: duplicate of the sum of the private liabilities'
    from public.liabilities l
    where l.id = r.id;

    delete from public.liabilities where id = r.id;
    removed := removed + 1;
  end loop;
  return removed;
end;
$$;
revoke all on function archive.dedupe_liability_total() from public, anon, authenticated;

do $$
declare
  n integer;
begin
  n := archive.dedupe_liability_total();
  raise notice '0085: % duplicate total liabilit(y/ies) archived and removed', n;
end;
$$;
