# Migration notes

## Landed by `migrate_workbook.py` (this pass)

- `orgs` (one row, placeholder `own_afm` -- **set the real one before any AADE import**)
- `projects` — 8, from the `Ρυθμίσεις` pick-list
- `contacts` — 17, from `Επαφές`
- `accounts` — 6 liquid accounts, from `Λογαριασμοί` (see correction below)
- `categories` — 19, from the `Ρυθμίσεις` pick-list
- `transactions` — 102, from `Κινήσεις`, with `counterparty_afm` backfilled from the
  resolved contact when the workbook's own (VLOOKUP-derived) ΑΦΜ column was blank

All counts verified against direct workbook extraction. Zero unmapped Greek literals.

## Design correction made during migration

The plan's ground-truth notes listed **7 accounts** including Χρυσός and
Κρυπτονομίσματα (Exodus). Re-examining `Λογαριασμοί` during migration: those
two rows sit under a *different* header ("Στοιχείο / Εκτιμώμενη Αξία /
Ποσοστό" — estimated value / ownership %), alongside real estate and
watches — i.e. they are shaped exactly like the `assets` table, not an
account with an opening balance and movements. **They now migrate to
`assets`, not `accounts`** (see below). The true liquid-account count is 6.

## Not yet handled — natural next increments

Each of these needs its own mapping pass, same fail-loud approach:

1. **Installment plans.** The 11 recurring rows live only in the *generated*
   `back_office_operations.xlsx` (Table_Kin), not in the hand-kept source of
   truth. Needs: `bake_values.ps1` run first (the generated file has no
   cached formula values), then read Table_Kin's recurring columns
   (per-installment amount, installment count, first due date, last-paid
   date) into `installment_plans` + a call to `regenerate_plan()` per plan.

2. **AADE ΜΑΡΚ / true invoice numbers.** `aade_exports/AADE_Master.xlsx` join
   on ΜΑΡΚ would recover the real `invoice_number` for the 31 AADE-origin
   rows (today the workbook stores ΜΑΡΚ *as* the invoice number, discarding
   the real one) and could also backfill any remaining blank
   `counterparty_afm` values more authoritatively than the contact-lookup
   fallback this pass uses.

3. **`project_budgets` / `budget_lines` / `project_model_inputs`.** From the
   `Προϋπολογισμοί` sheet — acquisition/studies/construction/other lines,
   contingency %, and the per-project business-plan assumptions (ADR,
   occupancy, loan terms, seasonality).

4. **`assets`.** Χρυσός (€11,219), Κρυπτονομίσματα (€4,785), Ακίνητο Λεγρενά
   (€70,000, 50%), Ακίνητο Γλυκά Νερά (€80,000, 50%), watches, KTM — all
   under the "Στοιχείο" block in `Λογαριασμοί`, `state='pending_inheritance'`
   for the two co-owned properties pending probate.

5. **`liabilities` / `expected_income`.** The "ΔΑΝΕΙΑ ΑΠΟ ΙΔΙΩΤΕΣ" and
   "ΑΝΑΜΕΝΟΜΕΝΑ ΕΙΣΕΡΧΟΜΕΝΑ" blocks in `Λογαριασμοί` — e.g. Αντώνης €340,000
   interest-free private loan, and the €160,000 (certain) / €70,000
   (probable) expected incoming amounts.

## Before running the migration for real

1. Run `tools/bake_values.ps1` if step 1 above is being done in the same
   pass (not required for the current scope).
2. Set `orgs.own_afm` to the real company ΑΦΜ — required before any AADE
   import can determine transaction direction.
3. Run `py tools/migrate_workbook.py --dry-run` and confirm zero unmapped
   literals.
4. Apply `backoffice/seed/0100_migrated_data.sql` to the database.
5. Run `py tools/verify_migration.py` (needs `DATABASE_URL` set) and confirm
   it passes clean before trusting the data.
