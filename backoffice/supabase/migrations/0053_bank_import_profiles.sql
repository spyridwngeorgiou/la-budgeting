-- 0053: bank statement layouts ("profiles").
--
-- No Greek bank publishes a stable export schema, and the real exports have
-- not been seen yet, so the importer is generic: a profile says which header
-- row identifies the layout and how to read each column. The presets seeded
-- below are best guesses (verified = false) -- the column-mapping wizard
-- saves an org's own corrected copy, which then wins over the preset.
--
-- src/lib/ingest/profiles/presets.ts mirrors these seed rows so detection
-- and the tests work without a database round trip; keep them in lockstep.

create table bank_import_profiles (
  id uuid primary key default gen_random_uuid(),
  -- null = a built-in preset, readable by every internal user
  org_id uuid references orgs(id) on delete cascade,
  bank_code text not null,               -- piraeus | nbg | eurobank | alpha | generic | <custom>
  name text not null,
  file_kind text not null default 'csv' check (file_kind in ('csv', 'xlsx')),
  encoding text not null default 'utf-8' check (encoding in ('utf-8', 'windows-1253')),
  delimiter text check (delimiter in (',', ';', E'\t', '|')),   -- null = sniff
  -- Normalised header cells (see normalizeGreek) that must all appear in one
  -- row for this profile to match. Exports often start with a few lines of
  -- account details, so the header row is searched for, not assumed.
  header_signature text[] not null default '{}',
  -- field -> header text (or [alternatives], or a 0-based column index).
  -- Fields: date, value_date, description, amount, debit, credit, direction,
  -- balance, reference, counterparty, counterparty_iban.
  column_map jsonb not null,
  date_format text not null default 'dd/MM/yyyy',
  decimal_separator text not null default ',' check (decimal_separator in (',', '.')),
  sign_mode bank_sign_mode not null default 'signed',
  -- direction_column only: cell values that mean "debit" (money out).
  debit_markers text[] not null default '{}',
  -- Rows whose first non-empty cell matches this (case/accent-insensitive)
  -- regex are totals/footers, never movements.
  footer_pattern text,
  verified boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bank_import_profiles_name_uq
  on bank_import_profiles (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), bank_code, name);
create trigger bank_import_profiles_set_updated_at before update on bank_import_profiles
  for each row execute function set_updated_at();

alter table bank_import_profiles enable row level security;
-- Same viewer/editor split as 0012, plus: presets (org_id null) are readable
-- by every internal user and writable by no one through the API. External
-- partners (0037) read nothing outside the collaboration space, presets
-- included -- is_internal_user() keeps them out.
create policy bank_import_profiles_select on bank_import_profiles
  for select using ((org_id is null and is_internal_user()) or has_role(org_id, 'viewer'));
create policy bank_import_profiles_insert on bank_import_profiles
  for insert with check (org_id is not null and has_role(org_id, 'editor'));
create policy bank_import_profiles_update on bank_import_profiles
  for update using (org_id is not null and has_role(org_id, 'editor'))
  with check (org_id is not null and has_role(org_id, 'editor'));
create policy bank_import_profiles_delete on bank_import_profiles
  for delete using (org_id is not null and has_role(org_id, 'editor'));

-- Unverified presets. Header texts are the commonly seen e-banking labels;
-- replace with the real ones once a sample export per bank is available.
insert into bank_import_profiles
  (org_id, bank_code, name, file_kind, encoding, delimiter, header_signature, column_map, date_format, decimal_separator, sign_mode, debit_markers, footer_pattern)
values
  (null, 'piraeus', 'Τράπεζα Πειραιώς (CSV)', 'csv', 'windows-1253', ';',
   array['ΗΜΕΡΟΜΗΝΙΑ', 'ΠΕΡΙΓΡΑΦΗ', 'ΧΡΕΩΣΗ', 'ΠΙΣΤΩΣΗ'],
   '{"date": "ΗΜΕΡΟΜΗΝΙΑ", "value_date": ["ΗΜ/ΝΙΑ ΑΞΙΑΣ", "ΑΞΙΑ"], "description": "ΠΕΡΙΓΡΑΦΗ", "debit": "ΧΡΕΩΣΗ", "credit": "ΠΙΣΤΩΣΗ", "balance": "ΥΠΟΛΟΙΠΟ", "reference": ["ΑΡ. ΣΥΝΑΛΛΑΓΗΣ", "ΚΩΔΙΚΟΣ ΣΥΝΑΛΛΑΓΗΣ"]}',
   'dd/MM/yyyy', ',', 'debit_credit', '{}', '^(ΣΥΝΟΛ|ΥΠΟΛΟΙΠΟ)'),
  (null, 'nbg', 'Εθνική Τράπεζα (CSV)', 'csv', 'windows-1253', ';',
   array['ΗΜΕΡΟΜΗΝΙΑ', 'ΠΕΡΙΓΡΑΦΗ', 'ΠΟΣΟ', 'ΠΡΟΣΗΜΟ ΠΟΣΟΥ'],
   '{"date": "ΗΜΕΡΟΜΗΝΙΑ", "value_date": ["ΗΜΕΡΟΜΗΝΙΑ ΑΞΙΑΣ", "ΗΜ/ΝΙΑ ΑΞΙΑΣ"], "description": "ΠΕΡΙΓΡΑΦΗ", "amount": "ΠΟΣΟ", "direction": "ΠΡΟΣΗΜΟ ΠΟΣΟΥ", "balance": ["ΛΟΓΙΣΤΙΚΟ ΥΠΟΛΟΙΠΟ", "ΥΠΟΛΟΙΠΟ"], "reference": ["ΑΡΙΘΜΟΣ ΣΥΝΑΛΛΑΓΗΣ", "ΑΡ. ΣΥΝΑΛΛΑΓΗΣ"], "counterparty": ["ΟΝΟΜΑ ΑΝΤΙΣΥΜΒΑΛΛΟΜΕΝΟΥ", "ΑΝΤΙΣΥΜΒΑΛΛΟΜΕΝΟΣ"], "counterparty_iban": ["IBAN ΑΝΤΙΣΥΜΒΑΛΛΟΜΕΝΟΥ"]}',
   'dd/MM/yyyy', ',', 'direction_column', array['Χ', 'ΧΡΕΩΣΗ', 'D', '-'], '^(ΣΥΝΟΛ|ΥΠΟΛΟΙΠΟ)'),
  (null, 'eurobank', 'Eurobank (XLSX)', 'xlsx', 'utf-8', null,
   array['ΗΜΕΡΟΜΗΝΙΑ', 'ΠΕΡΙΓΡΑΦΗ', 'ΠΟΣΟ', 'ΥΠΟΛΟΙΠΟ'],
   '{"date": ["ΗΜΕΡΟΜΗΝΙΑ", "ΗΜΕΡΟΜΗΝΙΑ ΣΥΝΑΛΛΑΓΗΣ"], "value_date": "ΗΜΕΡΟΜΗΝΙΑ ΑΞΙΑΣ", "description": "ΠΕΡΙΓΡΑΦΗ", "amount": "ΠΟΣΟ", "balance": "ΥΠΟΛΟΙΠΟ", "reference": ["ΑΡΙΘΜΟΣ ΑΝΑΦΟΡΑΣ", "ΑΙΤΙΟΛΟΓΙΑ"]}',
   'dd/MM/yyyy', ',', 'signed', '{}', '^(ΣΥΝΟΛ|ΥΠΟΛΟΙΠΟ)'),
  (null, 'alpha', 'Alpha Bank (CSV)', 'csv', 'windows-1253', ';',
   array['ΗΜ/ΝΙΑ', 'ΑΙΤΙΟΛΟΓΙΑ', 'ΠΟΣΟ'],
   '{"date": "ΗΜ/ΝΙΑ", "value_date": ["ΗΜ/ΝΙΑ ΑΞΙΑΣ", "ΑΞΙΑ"], "description": "ΑΙΤΙΟΛΟΓΙΑ", "amount": "ΠΟΣΟ", "balance": "ΥΠΟΛΟΙΠΟ", "reference": ["ΚΩΔ. ΣΥΝΑΛΛΑΓΗΣ", "ΑΡ. ΣΥΝΑΛΛΑΓΗΣ"]}',
   'dd/MM/yyyy', ',', 'trailing_minus', '{}', '^(ΣΥΝΟΛ|ΥΠΟΛΟΙΠΟ)'),
  (null, 'generic', 'Γενική μορφή (ημερομηνία / περιγραφή / ποσό)', 'csv', 'utf-8', null,
   array['ΗΜΕΡΟΜΗΝΙΑ', 'ΠΕΡΙΓΡΑΦΗ', 'ΠΟΣΟ'],
   '{"date": ["ΗΜΕΡΟΜΗΝΙΑ", "DATE"], "value_date": ["ΗΜΕΡΟΜΗΝΙΑ ΑΞΙΑΣ", "VALUE DATE"], "description": ["ΠΕΡΙΓΡΑΦΗ", "ΑΙΤΙΟΛΟΓΙΑ", "DESCRIPTION"], "amount": ["ΠΟΣΟ", "AMOUNT"], "balance": ["ΥΠΟΛΟΙΠΟ", "BALANCE"], "reference": ["ΑΝΑΦΟΡΑ", "REFERENCE"]}',
   'dd/MM/yyyy', ',', 'signed', '{}', '^(ΣΥΝΟΛ|ΥΠΟΛΟΙΠΟ|TOTAL)');
