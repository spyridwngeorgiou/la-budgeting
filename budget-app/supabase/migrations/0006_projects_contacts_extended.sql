alter table public.projects
  add column if not exists budget_target numeric(14,2),
  add column if not exists risk_level text not null default 'medium',
  add column if not exists owner_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.projects
  drop constraint if exists projects_risk_level_check;

alter table public.projects
  add constraint projects_risk_level_check
  check (risk_level in ('low', 'medium', 'high'));

alter table public.contacts
  add column if not exists contact_type text not null default 'supplier',
  add column if not exists vat_number text,
  add column if not exists payment_terms_days integer,
  add column if not exists iban text,
  add column if not exists default_vat_rate numeric(5,2),
  add column if not exists default_withholding_rate numeric(5,2),
  add column if not exists email text,
  add column if not exists phone text;

alter table public.contacts
  drop constraint if exists contacts_contact_type_check;

alter table public.contacts
  add constraint contacts_contact_type_check
  check (contact_type in ('supplier', 'client', 'both'));

alter table public.contacts
  drop constraint if exists contacts_payment_terms_days_check;

alter table public.contacts
  add constraint contacts_payment_terms_days_check
  check (payment_terms_days is null or payment_terms_days between 0 and 365);

alter table public.contacts
  drop constraint if exists contacts_default_vat_rate_check;

alter table public.contacts
  add constraint contacts_default_vat_rate_check
  check (default_vat_rate is null or default_vat_rate between 0 and 100);

alter table public.contacts
  drop constraint if exists contacts_default_withholding_rate_check;

alter table public.contacts
  add constraint contacts_default_withholding_rate_check
  check (default_withholding_rate is null or default_withholding_rate between 0 and 100);

update public.contacts
set contact_type = case
  when kind = 'client' then 'client'
  else 'supplier'
end
where contact_type is null or contact_type not in ('supplier', 'client', 'both');
