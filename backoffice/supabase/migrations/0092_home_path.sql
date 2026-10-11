-- Each user picks the page the app opens on (/ redirects there). Null means
-- the default, /dashboard. The list matches src/lib/homePath.ts; a value
-- outside it is rejected here too, so a forged form post can never store an
-- arbitrary redirect target. RLS is unchanged: profiles_write (0002) already
-- limits writes to the caller's own row. Non-destructive.
alter table profiles
  add column home_path text null;

alter table profiles
  add constraint profiles_home_path_check check (
    home_path is null or home_path in (
      '/dashboard', '/inbox', '/transactions', '/projects',
      '/calendar', '/planner', '/reports/cash', '/accounts'
    )
  );
