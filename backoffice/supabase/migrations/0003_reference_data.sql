-- 0003: master data — projects, contacts, accounts, categories

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  code text not null,                       -- 'Q003_LAZARAKI32_GLYFADA'
  display_name text not null,               -- 'Λαζαράκη 32, Γλυφάδα'
  aliases text[] not null default '{}',     -- search + AI resolution hints
  project_type project_type,
  status project_status not null default 'active',
  business_model business_model,
  legal_relation text,                      -- 'Μίσθωση από ιδιοκτήτες'
  phase text,                               -- 'Αδειοδότηση'
  units int,
  collateral_value numeric(14,2),           -- Q001: 250000
  start_date date,
  construction_end_date date,
  opening_date date,
  rent_start_date date,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create trigger projects_set_updated_at before update on projects
  for each row execute function set_updated_at();

create table contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  afm text,
  search_key text,                          -- normalised name, trigger-maintained (see below)
  aliases text[] not null default '{}',
  kind text,                                -- supplier | client | both | authority
  phone text,
  email text,
  iban text,
  address text,
  default_vat_rate numeric(6,4) not null default 0.24,
  default_withholding_rate numeric(6,4) not null default 0,
  payment_terms_days int check (payment_terms_days between 0 and 365),
  kad_code text,
  kad_description text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint afm_9_digits check (afm is null or afm ~ '^[0-9]{9}$')
);
create unique index contacts_org_afm_uq on contacts (org_id, afm) where afm is not null and afm <> '';
create index contacts_search_key_trgm on contacts using gin (search_key gin_trgm_ops);
create trigger contacts_set_updated_at before update on contacts
  for each row execute function set_updated_at();

create extension if not exists unaccent;

-- Greek-aware name normaliser used both to maintain search_key and, later,
-- by the AI contact-resolution ladder (kept identical so results agree).
create or replace function public.normalize_greek_name(p_name text) returns text
language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(
      translate(
        upper(unaccent(coalesce(p_name,''))),
        'ΆΈΉΊΌΎΏΪΫ', 'ΑΕΗΙΟΥΩΙΥ'
      ),
      '\y(Α\.?Ε\.?|Ε\.?Π\.?Ε\.?|Ι\.?Κ\.?Ε\.?|Ο\.?Ε\.?|Ε\.?Ε\.?|ΜΟΝ\.?|ΙΔΙΩΤΙΚΗ ΚΕΦΑΛΑΙΟΥΧΙΚΗ)\y',
      '', 'g'
    ),
    '\s+', ' ', 'g'
  ))
$$;

create or replace function public.contacts_set_search_key() returns trigger
language plpgsql as $$
begin
  new.search_key := normalize_greek_name(new.name);
  return new;
end;
$$;
create trigger contacts_search_key before insert or update of name on contacts
  for each row execute function contacts_set_search_key();

create table accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  kind account_kind not null default 'bank',
  owner_scope owner_scope not null,
  is_liquid boolean not null default true,   -- gold & crypto => false
  opening_balance numeric(14,2) not null default 0,
  opening_balance_date date not null,
  project_id uuid references projects(id),   -- earmarked account, e.g. a project loan
  iban text,
  notes text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);
create trigger accounts_set_updated_at before update on accounts
  for each row execute function set_updated_at();

create table categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  code text,
  name text not null,
  kind tx_direction,                          -- null = usable for both
  scope tx_scope not null default 'business',
  is_financing boolean not null default false,-- replaces the workbook's 'Δάνειο' string hack
  keywords text[] not null default '{}',      -- 'τσιμέντ','σοβά' -> Υλικά (rules + AI)
  parent_id uuid references categories(id),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create trigger categories_set_updated_at before update on categories
  for each row execute function set_updated_at();
