-- 0013: scheduled jobs
-- pg_cron is available on the Supabase free tier.

create extension if not exists pg_cron;

-- Nightly roll-forward for indefinite installment plans (installment_count is
-- null), e.g. the 23-year lease. Also self-heals via ensure_plans_current()
-- called from the dashboard loader, so a paused-then-resumed project catches
-- up without waiting for this job.
select cron.schedule(
  'roll-forward-installment-plans',
  '0 3 * * *',   -- 03:00 UTC nightly
  $$ select public.ensure_plans_current(); $$
);
