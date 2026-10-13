-- 0094: statements that say which account they are.
--
-- Piraeus e-banking XLSX prints the account's IBAN above the table; the
-- Optima PDF prints a plain 14-digit «Αριθμός λογαριασμού». accounts.iban
-- exists since 0003; account_number is new, so an account the bank only
-- identifies by number is still picked automatically on upload
-- (lib/ingest/profiles/header.ts matchStatementAccount). Digits only.
--
-- Also seeds the «Πειραιώς (XLSX, e-banking)» preset, built from a real
-- export (hence verified). src/lib/ingest/profiles/presets.ts mirrors it.
-- column_map's {"join": [...]} reads several columns as one field.

alter table accounts add column account_number text;
alter table accounts add constraint accounts_account_number_digits
  check (account_number is null or account_number ~ '^[0-9]{6,34}$');

comment on column accounts.account_number is
  'The bank''s own account number (digits only), as printed on statements that show no IBAN.';

insert into bank_import_profiles
  (org_id, bank_code, name, file_kind, encoding, delimiter, header_signature, column_map, date_format, decimal_separator, sign_mode, debit_markers, footer_pattern, verified)
values
  (null, 'piraeus', 'Πειραιώς (XLSX, e-banking)', 'xlsx', 'utf-8', null,
   array['ΚΑΤΗΓΟΡΙΑ', 'ΠΕΡΙΓΡΑΦΗ ΣΥΝΑΛΛΑΓΗΣ', 'ΗΜ/ΝΙΑ ΣΥΝΑΛΛΑΓΗΣ', 'ΣΧΟΛΙΑ / ΚΩΔΙΚΟΣ ΑΝΑΦΟΡΑΣ', 'ΠΟΣΟ', 'ΠΡΟΟΔΕΥΤΙΚΟ ΛΟΓΙΣΤΙΚΟ ΥΠΟΛΟΙΠΟ'],
   '{"date": "ΗΜ/ΝΙΑ ΣΥΝΑΛΛΑΓΗΣ", "description": {"join": ["ΠΕΡΙΓΡΑΦΗ ΣΥΝΑΛΛΑΓΗΣ", "ΣΧΟΛΙΑ / ΚΩΔΙΚΟΣ ΑΝΑΦΟΡΑΣ"]}, "amount": "ΠΟΣΟ", "balance": "ΠΡΟΟΔΕΥΤΙΚΟ ΛΟΓΙΣΤΙΚΟ ΥΠΟΛΟΙΠΟ"}',
   'dd/MM/yyyy', ',', 'signed', '{}', '^(ΗΜΕΡΟΜΗΝΙΑ ΕΝΗΜΕΡΩΣΗΣ|ΣΥΝΟΛ)', true)
on conflict do nothing;
