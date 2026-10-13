-- 0028: daily myDATA sync. Every morning the database calls the app's
-- /api/sync/mydata (pg_net), which fetches the last 45 days of invoices from
-- ΑΑΔΕ and stages only the new ones for review. Nothing is committed to the
-- ledger without a person approving it.
--
-- The shared secret and the app URL live in Supabase Vault (names
-- 'sync_secret' and 'app_url'), set once outside the repo:
--   select vault.create_secret('<secret>', 'sync_secret');
--   select vault.create_secret('https://<app host>', 'app_url');

create extension if not exists pg_net;

create or replace function public.call_mydata_sync() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url');
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret');
begin
  if v_url is null or v_secret is null then
    raise notice 'myDATA sync skipped: app_url / sync_secret not set in Vault';
    return null;
  end if;
  return net.http_post(
    url := v_url || '/api/sync/mydata',
    headers := jsonb_build_object('x-sync-secret', v_secret, 'content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.call_mydata_sync() from public, anon, authenticated;

-- 04:30 UTC = 06:30 Athens in winter, 07:30 in summer.
select cron.schedule('mydata-daily-sync', '30 4 * * *', $$ select public.call_mydata_sync(); $$);
