-- 0001: extensions and domain enums
-- All Greek display labels live in src/lib/i18n/el.ts, never in the database.

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- fuzzy contact-name matching

-- access
create type org_role as enum ('owner','admin','editor','viewer');

-- ledger
create type tx_direction as enum ('income','expense');                      -- Έσοδο / Έξοδο
create type tx_scope     as enum ('business','personal');                   -- Πεδίο
create type tx_status    as enum ('paid','pending','scheduled','cancelled');-- Πληρωμένο / Εκκρεμεί / Προγραμματισμένο
create type tx_origin    as enum ('aade','manual','bank_file','ai_document','ai_nl');

-- master data
create type account_kind   as enum ('bank','cash','gold','crypto','other');
create type owner_scope    as enum ('corporate','personal');                -- Εταιρικός / Προσωπικός
create type project_type   as enum ('construction','installation','renovation','hospitality','general');
create type project_status as enum ('offer','active','on_hold','completed','cancelled');
create type business_model as enum ('own_development','client_project','hotel_lease','general');

-- installments
create type plan_frequency as enum ('monthly','quarterly','semiannual','annual');
create type plan_status    as enum ('active','completed','cancelled');

-- tax
create type filing_status as enum ('pending','filed','paid','cancelled');

-- budgets
create type budget_line_code as enum ('acquisition','studies_permits_legal','construction_equipment','other');

-- wealth and financing
create type certainty       as enum ('certain','probable');                 -- Βέβαιο / Πιθανό
create type liability_kind  as enum ('private','bank');
create type liability_state as enum ('in_application','approved','disbursed','repaid');
create type asset_state     as enum ('held','pending_inheritance');

-- AADE myDATA import
create type aade_kind         as enum ('expenses','income');
create type aade_batch_status as enum ('draft','committed','discarded');
create type aade_dedup_status as enum ('new','dup_mark','dup_fingerprint','dup_self_classification','dup_in_batch');
create type aade_decision     as enum ('import','skip');

-- shared updated_at trigger
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
