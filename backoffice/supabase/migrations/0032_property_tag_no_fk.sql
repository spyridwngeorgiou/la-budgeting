-- 0032: drop the foreign key on transactions.property_project_id (0028).
--
-- A second FK from transactions to projects makes every PostgREST embed like
-- `transactions?select=...,projects(display_name)` ambiguous (PGRST201: "more
-- than one relationship was found") -- the transactions list, analysis,
-- contacts, CSV export and the AI tools all embed projects that way, and all
-- of them broke. Keeping exactly one transactions -> projects relationship
-- (project_id) keeps every existing and future embed unambiguous.
--
-- property_project_id stays a plain uuid. It is only ever set from a project
-- picker, and v_property_monthly_cost simply finds no project for a
-- dangling id, so losing the FK costs nothing that matters here.

alter table transactions drop constraint transactions_property_project_id_fkey;
