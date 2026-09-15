-- 0202: Q004 lease, base scenario, operating costs, status notes
--
-- Completes the Q004 workbook's remaining blocks as data, so the project
-- one-pager derives every figure instead of restating it. The target to
-- reproduce, from Q004_ΑγΚωνσταντίνου.xlsx:
--
--   Ετήσιος τζίρος        120.000
--   Λειτουργικό κόστος    −40.000
--   Μίσθωμα (777 × 12)     −9.324
--   ΕΤΗΣΙΟ ΑΠΟΤΕΛΕΣΜΑ      70.676        margin 58,9%

begin;

-- ── Lease: 777/μήνα to the landlords, 16 years ─────────────────────────────
-- The workbook gives the term and the monthly amount but not a start month;
-- the land-registry entry on 27/08/2026 is the only dated anchor, so the lease
-- is recorded as starting the following month and flagged as approximate. The
-- annual rent figure the one-pager shows does not depend on it.

with ctx as (
  select id as project_id, org_id from projects
  where code = 'Q004_AGIOU_KWNSTANTINOU20_GLYFADA'
), l as (
  insert into project_leases (org_id, project_id, kind, lease_start_month, term_years,
                              first_payment_month, notes)
  select org_id, project_id, 'indexed_rent', date '2026-09-01', 16, date '2026-09-01',
         'Μίσθωση 16 ετών. Η καταχώριση στο κτηματολόγιο έγινε 27/08/2026. '
         || 'ΠΑΡΑΔΟΧΗ: ο μήνας έναρξης δεν αναφέρεται στο υπολογιστικό φύλλο. '
         || 'Πέραν του μισθώματος, η εταιρεία εξυπηρετεί και τις ρυθμίσεις ΑΑΔΕ '
         || 'των ιδιοκτητών «αντί ενοικίου» — βλ. συνδεδεμένα πλάνα δόσεων.'
  from ctx
  on conflict (org_id, project_id) do update set notes = excluded.notes
  returning id
)
insert into lease_indexed_terms (lease_id, base_monthly_amount, stamp_duty_pct,
                                 stamp_duty_surcharge_pct, escalation_pct)
select id, 777.00, 0, 0, 0 from l
on conflict (lease_id) do update set base_monthly_amount = excluded.base_monthly_amount;

-- The three ρυθμίσεις are what makes this lease unusual: record the link, not
-- a copy of their schedule.
insert into lease_serviced_settlements (lease_id, installment_plan_id)
select l.id, p.id
from project_leases l
join projects pr on pr.id = l.project_id and pr.code = 'Q004_AGIOU_KWNSTANTINOU20_GLYFADA'
join installment_plans p on p.project_id = l.project_id
  and p.obligation_kind = 'third_party_tax_settlement'
on conflict do nothing;

-- ── Base scenario: the stabilised operating year ───────────────────────────
-- No room-type grid: the workbook models a single flat 120.000 of revenue,
-- and inventing room types to force it through revenue_plans would be fiction.

with ctx as (
  select id as project_id, org_id from projects
  where code = 'Q004_AGIOU_KWNSTANTINOU20_GLYFADA'
), s as (
  insert into project_scenarios (org_id, project_id, code, name, is_base,
                                 flat_annual_revenue, discount_rate_pct, notes)
  select org_id, project_id, 'base', 'Σταθεροποιημένο έτος', true, 120000.00, 0.09,
         'Από Q004_ΑγΚωνσταντίνου.xlsx, μπλοκ ΛΕΙΤΟΥΡΓΙΑ. Ένα σταθεροποιημένο έτος '
         || 'χωρίς ράμπα εκκίνησης και χωρίς εποχικότητα, όπως στο υπολογιστικό φύλλο.'
  from ctx
  on conflict (org_id, project_id, code) do update
    set flat_annual_revenue = excluded.flat_annual_revenue, notes = excluded.notes
  returning id, org_id
)
insert into opex_lines (org_id, scenario_id, kind, label, annual_amount, category_id, note)
select s.org_id, s.id, 'fixed_annual', 'Λειτουργικό κόστος', 40000.00,
       (select id from categories where code = 'ΛΕΙΤΟΥΡΓΙΚΆ'),
       'Ενιαίο ποσό στο υπολογιστικό φύλλο, χωρίς ανάλυση σε γραμμές.'
from s
on conflict do nothing;

-- ── ΚΑΤΑΣΤΑΣΗ: the status block, verbatim ──────────────────────────────────

insert into project_notes (org_id, project_id, kind, severity, body, exposure_amount, sort_order)
select p.org_id, p.id, v.kind::project_note_kind, v.severity::project_note_severity,
       v.body, v.exposure, v.sort_order
from projects p, (values
  ('milestone', 'info',
   'Άνοιγμα προγραμματισμένο για Δεκέμβριο 2026.', null::numeric, 1),
  ('risk', 'watch',
   'Η ανακαίνιση των 90.000 δεν έχει ανατεθεί με σύμβαση — είναι εκτίμηση.', null, 2),
  ('action', 'urgent',
   'Χρειάζεται τιμολόγιο για τα 35.000 μεσιτικά που πληρώθηκαν 30/07/2026. '
   || 'Χωρίς αυτό κοστίζει 16.100 σε φόρο και ΦΠΑ (24% ΦΠΑ + 22% φόρος).', 16100.00, 3),
  ('milestone', 'info',
   'Το κτηματολόγιο της μίσθωσης καταχωρήθηκε 27/08/2026, κόστος 569,50.', null, 4)
) as v(kind, severity, body, exposure, sort_order)
where p.code = 'Q004_AGIOU_KWNSTANTINOU20_GLYFADA'
on conflict do nothing;

commit;
