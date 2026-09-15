-- 0200: Q003 Λαζαράκη + Q004 Αγ. Κωνσταντίνου baseline
--
-- The planning half of these two projects, taken from the hand-kept workbooks
-- (Λαζαράκη_1.xlsx and Q004_ΑγΚωνσταντίνου.xlsx) into the tables that were
-- designed for it and have been empty until now. Idempotent: re-running
-- updates in place rather than duplicating.
--
-- Deliberately NOT seeded here: "spent to date". Both workbooks carry it as a
-- hand-copied number (Λαζαράκη: 16.744, already stale against the ledger's
-- 17.005) and the app derives it live from `transactions` instead. That drift
-- is the whole reason this data is moving out of Excel.

begin;

-- ── Project master fields (all NULL until now) ──────────────────────────────

update projects set
  project_type        = 'hospitality',
  business_model      = 'hotel_lease',
  units               = 21,                       -- Junior 10 + Deluxe 10 + Penthouse 1
  legal_relation      = 'Μίσθωση 23 ετών από ιδιοκτήτες',
  phase               = 'Χρηματοδότηση / αδειοδότηση',
  collateral_value    = 400000,                   -- «Δεσμεύεται, δεν ξοδεύεται» — pledged, not spent
  opening_date        = date '2027-08-01',
  rent_start_date     = date '2027-09-01'         -- first rent one month after opening
where code = 'Q003_LAZARAKI32_GLYFADA';

update projects set
  project_type        = 'renovation',
  business_model      = 'hotel_lease',
  legal_relation      = 'Μίσθωση 16 ετών',
  phase               = 'Ανακαίνιση',
  opening_date        = date '2026-12-01'
where code = 'Q004_AGIOU_KWNSTANTINOU20_GLYFADA';

-- ── Q004 capex budget: 15.218 + 90.000 + 55.000 = 160.218 ───────────────────

with p as (
  select id, org_id from projects where code = 'Q004_AGIOU_KWNSTANTINOU20_GLYFADA'
), b as (
  insert into project_budgets (org_id, project_id, version, is_current, contingency_pct, notes)
  select org_id, id, 1, true, 0,
         'Από Q004_ΑγΚωνσταντίνου.xlsx, φύλλο Σύνοψη (Σεπτ. 2026). ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ 160.218.'
  from p
  on conflict (org_id, project_id, version) do update
    set is_current = true, notes = excluded.notes
  returning id, org_id
)
insert into budget_lines (org_id, budget_id, line_code, label, amount)
select b.org_id, b.id, v.line_code::budget_line_code, v.label, v.amount
from b, (values
  ('studies_permits_legal', 'Μελέτες, άδειες, νομικά', 15218.00),
  ('construction_equipment', 'Ανακαίνιση',              90000.00),
  ('other',                  'Μεσιτική αμοιβή',          55000.00)
) as v(line_code, label, amount)
on conflict (budget_id, line_code) do update
  set label = excluded.label, amount = excluded.amount;

-- ── Q003 investment: a single 2.000.000 lump, honestly labelled ─────────────
-- The workbook has NO capex breakdown (Παραδοχές!B17 is one scalar, with a
-- prose note listing «κατασκευή, FF&E, λειτουργικό εξοπλισμό και προ-έναρξη»).
-- Inventing a four-way split would look authoritative and be fiction; one
-- line, with the note, is the honest representation until real figures exist.

with p as (
  select id, org_id from projects where code = 'Q003_LAZARAKI32_GLYFADA'
), b as (
  insert into project_budgets (org_id, project_id, version, is_current, contingency_pct, notes)
  select org_id, id, 1, true, 0,
         'Από Λαζαράκη_1.xlsx, φύλλο Παραδοχές (Αύγ. 2026). Ενιαίο ποσό 2.000.000 '
         || '— περιλαμβάνει κατασκευή, FF&E, λειτουργικό εξοπλισμό και προ-έναρξη, '
         || 'χωρίς ανάλυση στο υπολογιστικό φύλλο.'
  from p
  on conflict (org_id, project_id, version) do update
    set is_current = true, notes = excluded.notes
  returning id, org_id
)
insert into budget_lines (org_id, budget_id, line_code, label, amount)
select b.org_id, b.id, 'construction_equipment', 'Συνολική επένδυση (ενιαίο ποσό)', 2000000.00
from b
on conflict (budget_id, line_code) do update
  set label = excluded.label, amount = excluded.amount;

commit;
