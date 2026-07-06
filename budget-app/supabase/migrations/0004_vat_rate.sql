-- Add VAT rate (%) to transactions, e.g. 24, 13, 6, 0.
alter table public.transactions
  add column if not exists vat_rate numeric(5,2) not null default 0;
