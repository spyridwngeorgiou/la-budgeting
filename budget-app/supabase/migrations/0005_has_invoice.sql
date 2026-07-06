-- Invoice flag: distinguishes formal (invoiced, VAT-relevant) from informal
-- (usually cash) transactions. Backfill: anything with VAT recorded had an invoice.
alter table public.transactions
  add column if not exists has_invoice boolean not null default false;

update public.transactions set has_invoice = true where vat_amount > 0;
