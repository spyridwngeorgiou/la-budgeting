-- 0033: bank feed three times a day. Same mechanism as the myDATA sync
-- (0028): pg_cron calls the app's /api/sync/bank through pg_net with the
-- shared secret kept in Supabase Vault ('sync_secret', 'app_url').
-- 05:00, 11:00, 17:00 UTC = 07:00, 13:00, 19:00 Athens (winter).

create or replace function public.call_bank_sync() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url');
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret');
begin
  if v_url is null or v_secret is null then
    raise notice 'bank sync skipped: app_url / sync_secret not set in Vault';
    return null;
  end if;
  return net.http_post(
    url := v_url || '/api/sync/bank',
    headers := jsonb_build_object('x-sync-secret', v_secret, 'content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.call_bank_sync() from public, anon, authenticated;

select cron.schedule('bank-feed-morning', '0 5 * * *', $$ select public.call_bank_sync(); $$);
select cron.schedule('bank-feed-midday', '0 11 * * *', $$ select public.call_bank_sync(); $$);
select cron.schedule('bank-feed-evening', '0 17 * * *', $$ select public.call_bank_sync(); $$);
