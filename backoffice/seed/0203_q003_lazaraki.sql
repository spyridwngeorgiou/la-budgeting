-- 0203: Q003 Λαζαράκη 32 — the full model inputs
--
-- From Λαζαράκη_1.xlsx. Everything here is an input; the loan schedule, rent
-- schedule, operating result, cash flow and KPIs are all computed.
--
-- The revenue grid is NOT taken from the workbook's Λειτουργία sheet, which
-- holds 36 hand-pasted monthly totals with the drivers deleted. It is taken
-- from the occupancy/ADR curves in Glyfada_Hotel_Estimation.xlsx, rescaled from
-- 8/8/1 suites to this project's 10/10/1, which reproduce those totals exactly:
--   operating year 1  1.216.770  exact
--   operating year 3  1.469.935  exact
--   operating year 2  1.355.610 vs the workbook's 1.355.490, +120
-- The €120 is the leap day: operating year 2 falls in calendar 2028 and the
-- workbook charged February 28 days. A hotel does sell rooms on 29 February,
-- so the app is right and the workbook is 120 euros light.

begin;

with ctx as (
  select id as project_id, org_id from projects where code = 'Q003_LAZARAKI32_GLYFADA'
), plan as (
  insert into revenue_plans (org_id, project_id, name, start_year, years, notes)
  select org_id, project_id, 'Ξενοδοχείο 21 σουιτών — εκτίμηση εσόδων', 2027, 3,
         'Καμπύλες πληρότητας και ADR από Glyfada_Hotel_Estimation.xlsx, με 10/10/1 σουίτες.'
  from ctx
  returning id, org_id
), rt as (
  insert into revenue_plan_room_types (org_id, revenue_plan_id, name, unit_count, sort_order)
  select plan.org_id, plan.id, v.name, v.units, v.sort_order
  from plan, (values
    ('Junior Suites', 10, 1),
    ('Deluxe Suites', 10, 2),
    ('Penthouse', 1, 3)
  ) as v(name, units, sort_order)
  returning id, org_id, name
)
insert into revenue_plan_assumptions (org_id, room_type_id, year_number, month_number, occupancy_pct, adr)
select rt.org_id, rt.id, v.y, v.m, v.occ, v.adr
from rt, (values
    ('Junior Suites', 1, 1, 0.3, 105),
    ('Junior Suites', 1, 2, 0.33, 110),
    ('Junior Suites', 1, 3, 0.45, 140),
    ('Junior Suites', 1, 4, 0.6, 185),
    ('Junior Suites', 1, 5, 0.7, 280),
    ('Junior Suites', 1, 6, 0.76, 295),
    ('Junior Suites', 1, 7, 0.82, 315),
    ('Junior Suites', 1, 8, 0.86, 325),
    ('Junior Suites', 1, 9, 0.76, 295),
    ('Junior Suites', 1, 10, 0.6, 185),
    ('Junior Suites', 1, 11, 0.33, 110),
    ('Junior Suites', 1, 12, 0.4, 130),
    ('Deluxe Suites', 1, 1, 0.3, 130),
    ('Deluxe Suites', 1, 2, 0.33, 140),
    ('Deluxe Suites', 1, 3, 0.45, 175),
    ('Deluxe Suites', 1, 4, 0.6, 240),
    ('Deluxe Suites', 1, 5, 0.7, 395),
    ('Deluxe Suites', 1, 6, 0.76, 395),
    ('Deluxe Suites', 1, 7, 0.82, 395),
    ('Deluxe Suites', 1, 8, 0.86, 395),
    ('Deluxe Suites', 1, 9, 0.76, 395),
    ('Deluxe Suites', 1, 10, 0.6, 240),
    ('Deluxe Suites', 1, 11, 0.33, 140),
    ('Deluxe Suites', 1, 12, 0.4, 165),
    ('Penthouse', 1, 1, 0.32, 170),
    ('Penthouse', 1, 2, 0.37, 180),
    ('Penthouse', 1, 3, 0.5, 230),
    ('Penthouse', 1, 4, 0.65, 290),
    ('Penthouse', 1, 5, 0.75, 395),
    ('Penthouse', 1, 6, 0.8, 415),
    ('Penthouse', 1, 7, 0.85, 450),
    ('Penthouse', 1, 8, 0.88, 465),
    ('Penthouse', 1, 9, 0.8, 415),
    ('Penthouse', 1, 10, 0.65, 290),
    ('Penthouse', 1, 11, 0.37, 180),
    ('Penthouse', 1, 12, 0.45, 230),
    ('Junior Suites', 2, 1, 0.35, 110),
    ('Junior Suites', 2, 2, 0.38, 115),
    ('Junior Suites', 2, 3, 0.5, 145),
    ('Junior Suites', 2, 4, 0.65, 195),
    ('Junior Suites', 2, 5, 0.75, 295),
    ('Junior Suites', 2, 6, 0.8, 310),
    ('Junior Suites', 2, 7, 0.86, 330),
    ('Junior Suites', 2, 8, 0.89, 340),
    ('Junior Suites', 2, 9, 0.8, 310),
    ('Junior Suites', 2, 10, 0.65, 195),
    ('Junior Suites', 2, 11, 0.38, 115),
    ('Junior Suites', 2, 12, 0.45, 135),
    ('Deluxe Suites', 2, 1, 0.35, 140),
    ('Deluxe Suites', 2, 2, 0.38, 150),
    ('Deluxe Suites', 2, 3, 0.5, 185),
    ('Deluxe Suites', 2, 4, 0.65, 290),
    ('Deluxe Suites', 2, 5, 0.75, 395),
    ('Deluxe Suites', 2, 6, 0.8, 395),
    ('Deluxe Suites', 2, 7, 0.86, 395),
    ('Deluxe Suites', 2, 8, 0.89, 395),
    ('Deluxe Suites', 2, 9, 0.8, 395),
    ('Deluxe Suites', 2, 10, 0.65, 290),
    ('Deluxe Suites', 2, 11, 0.38, 150),
    ('Deluxe Suites', 2, 12, 0.45, 180),
    ('Penthouse', 2, 1, 0.37, 180),
    ('Penthouse', 2, 2, 0.42, 190),
    ('Penthouse', 2, 3, 0.55, 245),
    ('Penthouse', 2, 4, 0.7, 310),
    ('Penthouse', 2, 5, 0.8, 415),
    ('Penthouse', 2, 6, 0.84, 435),
    ('Penthouse', 2, 7, 0.88, 470),
    ('Penthouse', 2, 8, 0.91, 485),
    ('Penthouse', 2, 9, 0.84, 435),
    ('Penthouse', 2, 10, 0.7, 310),
    ('Penthouse', 2, 11, 0.42, 190),
    ('Penthouse', 2, 12, 0.5, 245),
    ('Junior Suites', 3, 1, 0.38, 115),
    ('Junior Suites', 3, 2, 0.41, 120),
    ('Junior Suites', 3, 3, 0.53, 155),
    ('Junior Suites', 3, 4, 0.68, 205),
    ('Junior Suites', 3, 5, 0.78, 310),
    ('Junior Suites', 3, 6, 0.83, 325),
    ('Junior Suites', 3, 7, 0.89, 345),
    ('Junior Suites', 3, 8, 0.92, 355),
    ('Junior Suites', 3, 9, 0.83, 325),
    ('Junior Suites', 3, 10, 0.68, 205),
    ('Junior Suites', 3, 11, 0.41, 120),
    ('Junior Suites', 3, 12, 0.48, 140),
    ('Deluxe Suites', 3, 1, 0.38, 150),
    ('Deluxe Suites', 3, 2, 0.41, 160),
    ('Deluxe Suites', 3, 3, 0.53, 200),
    ('Deluxe Suites', 3, 4, 0.68, 330),
    ('Deluxe Suites', 3, 5, 0.78, 395),
    ('Deluxe Suites', 3, 6, 0.83, 395),
    ('Deluxe Suites', 3, 7, 0.89, 395),
    ('Deluxe Suites', 3, 8, 0.92, 395),
    ('Deluxe Suites', 3, 9, 0.83, 395),
    ('Deluxe Suites', 3, 10, 0.68, 330),
    ('Deluxe Suites', 3, 11, 0.41, 160),
    ('Deluxe Suites', 3, 12, 0.48, 195),
    ('Penthouse', 3, 1, 0.4, 190),
    ('Penthouse', 3, 2, 0.45, 200),
    ('Penthouse', 3, 3, 0.58, 260),
    ('Penthouse', 3, 4, 0.73, 330),
    ('Penthouse', 3, 5, 0.83, 435),
    ('Penthouse', 3, 6, 0.87, 455),
    ('Penthouse', 3, 7, 0.91, 490),
    ('Penthouse', 3, 8, 0.94, 505),
    ('Penthouse', 3, 9, 0.87, 455),
    ('Penthouse', 3, 10, 0.73, 330),
    ('Penthouse', 3, 11, 0.45, 200),
    ('Penthouse', 3, 12, 0.53, 260)
  ) as v(name, y, m, occ, adr)
where v.name = rt.name;

-- ── Lease: 23 years, 6.000 base + 3% χαρτόσημο with 20% ΟΓΑ on the stamp,
-- 3,5% compounding, +1.500/μήνα from lease years 11 and 16 ────────────────
with ctx as (
  select id as project_id, org_id from projects where code = 'Q003_LAZARAKI32_GLYFADA'
), l as (
  insert into project_leases (org_id, project_id, kind, lease_start_month, term_years,
                              first_payment_month, notes)
  select org_id, project_id, 'indexed_rent', date '2027-08-01', 23, date '2027-09-01',
         'Πρώτη καταβολή έναν μήνα μετά το άνοιγμα, όπως στο Λαζαράκη_1.xlsx (Παραδοχές!B15).'
  from ctx
  on conflict (org_id, project_id) do update set notes = excluded.notes
  returning id, org_id
), t as (
  insert into lease_indexed_terms (lease_id, base_monthly_amount, stamp_duty_pct,
                                   stamp_duty_surcharge_pct, escalation_pct, escalation_first_year)
  select id, 6000.00, 0.03, 0.20, 0.035, 2 from l
  on conflict (lease_id) do update set base_monthly_amount = excluded.base_monthly_amount
  returning lease_id
)
insert into lease_step_ups (org_id, lease_id, from_lease_year, monthly_amount)
select l.org_id, t.lease_id, v.yr, v.amt
from l, t, (values (11, 1500.00), (16, 1500.00)) as v(yr, amt)
on conflict (lease_id, from_lease_year) do update set monthly_amount = excluded.monthly_amount;

-- ── Financing: two tranches, one programme. 15 years, 3 of them grace,
-- amortisation from Νοέμβριος 2029. Drawdowns split pro-rata 50/50. ────────
with ctx as (
  select id as project_id, org_id from projects where code = 'Q003_LAZARAKI32_GLYFADA'
), ln as (
  insert into loans (org_id, project_id, label, principal, interest_rate, term_years,
                     grace_years, first_amortisation_month, state, notes)
  select ctx.org_id, ctx.project_id, v.label, v.principal, v.rate, 15, 3,
         date '2029-11-01', 'in_application', v.note
  from ctx, (values
    ('Δάνειο Α', 1000000.00, 0.0035, 'Χαμηλότοκο σκέλος.'),
    ('Δάνειο Β', 1000000.00, 0.0350,
     'ΠΑΡΑΔΟΧΗ: το επιτόκιο και η κατανομή των επιπλέον 400.000 σε αυτό το σκέλος δεν έχουν επιβεβαιωθεί με την τράπεζα.')
  ) as v(label, principal, rate, note)
  returning id, org_id, label
)
insert into loan_drawdowns (org_id, loan_id, scheduled_month, amount)
select ln.org_id, ln.id, v.month::date, v.amount
from ln, (values
  ('2026-11-01', 375000.00),
  ('2027-02-01', 375000.00),
  ('2027-05-01', 250000.00)
) as v(month, amount);

-- ── Scenarios ──────────────────────────────────────────────────────────────
-- Base: the workbook's «Σημερινό μοντέλο». Its operating costs are three
-- hand-entered annual figures rather than a formula, so they are recorded as
-- three per-year lines -- an honest representation of what the source holds.
-- The two «4 αστέρια» variants decompose cost properly and are modelled as
-- payroll / percent-of-revenue / fixed lines.
with ctx as (
  select id as project_id, org_id from projects where code = 'Q003_LAZARAKI32_GLYFADA'
), rp as (
  select id from revenue_plans where project_id = (select project_id from ctx) limit 1
), sc as (
  insert into project_scenarios (org_id, project_id, code, name, is_base, revenue_plan_id,
                                 revenue_growth_pct, opex_growth_pct,
                                 growth_starts_after_operating_year, discount_rate_pct,
                                 dscr_covenant_min, sort_order, notes)
  select ctx.org_id, ctx.project_id, v.code, v.name, v.is_base,
         (select id from rp), 0.025, 0.025, 3, 0.09, 1.2, v.sort_order, v.note
  from ctx, (values
    ('base', 'Σημερινό μοντέλο', true, 1, null),
    ('4star_full', '4 αστέρια — πλήρης στελέχωση', false, 2,
     'ΥΑ 216/2015: υποδοχή 24 ώρες, εστιατόριο 30% των κλινών, μπαρ, πρωινό άνω των 3 ωρών, room service 12 ωρών, καθημερινός καθαρισμός, χώρος υποδοχής 50 τ.μ., τουλάχιστον μία σουίτα, 4.000 μόρια από προαιρετικά κριτήρια.'),
    ('4star_lean', '4 αστέρια — βελτιστοποιημένη', false, 3,
     'Ο μάνατζερ αναλαμβάνει τη διαχείριση κρατήσεων με channel manager· η συντήρηση δίνεται σε εξωτερικό συνεργάτη.')
  ) as v(code, name, is_base, sort_order, note)
  returning id, org_id, code
)
insert into opex_lines (org_id, scenario_id, kind, label, annual_amount, pct_of_revenue,
                        headcount, monthly_wage, salaries_per_year, employer_contribution_pct,
                        premium_pct, months_active, from_operating_year, to_operating_year,
                        grows_with_opex_growth, sort_order, note)
select sc.org_id, sc.id, v.kind::opex_line_kind, v.label, v.annual, v.pct,
       v.headcount, v.wage, v.salaries, v.efka, v.premium, v.months,
       v.from_y, v.to_y, v.grows, v.sort_order, v.note
from sc, (values
  ('base', 'fixed_annual', 'Λειτουργικά έτους 1', 625057.00, null, null, null, null, null, null, null, 1, 1, false, 1, 'Χειροκίνητο ετήσιο ποσό στο φύλλο Λειτουργία, χωρίς ανάλυση σε γραμμές.'),
  ('base', 'fixed_annual', 'Λειτουργικά έτους 2', 676142.00, null, null, null, null, null, null, null, 2, 2, false, 2, null),
  ('base', 'fixed_annual', 'Λειτουργικά έτους 3', 716241.00, null, null, null, null, null, null, null, 3, 3, true, 3, 'Από το έτος 4 αυξάνεται με τον ρυθμό ανάπτυξης λειτουργικού κόστους.'),
  ('4star_full', 'payroll', 'Ρεσεψιόν', null, null, 5, 1200.00, 14, 0.21790, 0.14000, 12, 1, null, false, 10, 'ΥΠΟΧΡΕΩΤΙΚΟ — κριτήριο 2.6: υποδοχή ανοικτή 24 ώρες, 1.095 βάρδιες τον χρόνο.'),
  ('4star_lean', 'payroll', 'Ρεσεψιόν', null, null, 5, 1200.00, 14, 0.21790, 0.14000, 12, 1, null, false, 10, 'ΥΠΟΧΡΕΩΤΙΚΟ — κριτήριο 2.6: υποδοχή ανοικτή 24 ώρες, 1.095 βάρδιες τον χρόνο.'),
  ('4star_full', 'payroll', 'Μάνατζερ', null, null, 1, 2500.00, 14, 0.21790, 0, 12, 1, null, false, 11, 'Αναλαμβάνει και τη διαχείριση κρατήσεων στη βελτιστοποιημένη εκδοχή.'),
  ('4star_lean', 'payroll', 'Μάνατζερ', null, null, 1, 2500.00, 14, 0.21790, 0, 12, 1, null, false, 11, 'Αναλαμβάνει και τη διαχείριση κρατήσεων στη βελτιστοποιημένη εκδοχή.'),
  ('4star_full', 'payroll', 'Housekeeping μόνιμες', null, null, 4, 1000.00, 14, 0.21790, 0, 12, 1, null, false, 12, 'Πρότυπο 4 αστέρων: 12 δωμάτια ανά 8ωρη βάρδια.'),
  ('4star_lean', 'payroll', 'Housekeeping μόνιμες', null, null, 2, 1000.00, 14, 0.21790, 0, 12, 1, null, false, 12, 'Πρότυπο 4 αστέρων: 12 δωμάτια ανά 8ωρη βάρδια.'),
  ('4star_full', 'payroll', 'Πρωινό, εστίαση & room service', null, null, 3, 1100.00, 14, 0.21790, 0.14000, 12, 1, null, false, 13, 'ΥΠΟΧΡΕΩΤΙΚΟ — κριτήρια 7.1, 7.6, 7.7.'),
  ('4star_lean', 'payroll', 'Πρωινό, εστίαση & room service', null, null, 3, 1100.00, 14, 0.21790, 0.14000, 12, 1, null, false, 13, 'ΥΠΟΧΡΕΩΤΙΚΟ — κριτήρια 7.1, 7.6, 7.7.'),
  ('4star_full', 'payroll', 'Τεχνικός συντήρησης', null, null, 1, 1300.00, 14, 0.21790, 0, 12, 1, null, false, 14, 'Στη βελτιστοποιημένη δίνεται σε εξωτερικό συνεργάτη.'),
  ('4star_lean', 'payroll', 'Καμαριέρα εποχική', null, null, 1, 1000.00, 14, 0.21790, 0, 5, 1, null, false, 15, 'Μάιος–Σεπτέμβριος, όταν η πληρότητα ξεπερνά το 75%.'),
  ('4star_full', 'pct_of_revenue', 'Προμήθειες πλατφορμών', null, 0.2, null, null, null, null, null, null, 1, null, false, 20, 'Booking 15–20%, Airbnb 14–16%, απευθείας κρατήσεις 0%.'),
  ('4star_lean', 'pct_of_revenue', 'Προμήθειες πλατφορμών', null, 0.17, null, null, null, null, null, null, 1, null, false, 20, 'Booking 15–20%, Airbnb 14–16%, απευθείας κρατήσεις 0%.'),
  ('4star_full', 'pct_of_revenue', 'Εταιρεία διαχείρισης', null, 0.05, null, null, null, null, null, null, 1, null, false, 21, 'Κόβεται στη βελτιστοποιημένη: ο μάνατζερ κάνει τη δουλειά με channel manager.'),
  ('4star_full', 'pct_of_revenue', 'Συντήρηση', null, 0.01, null, null, null, null, null, null, 1, null, false, 22, '1% τα πρώτα πέντε χρόνια. Από το έκτο έτος 2,5–3%.'),
  ('4star_lean', 'pct_of_revenue', 'Συντήρηση', null, 0.01, null, null, null, null, null, null, 1, null, false, 22, '1% τα πρώτα πέντε χρόνια. Από το έκτο έτος 2,5–3%.'),
  ('4star_full', 'pct_of_revenue', 'POS και τραπεζικά', null, 0.015, null, null, null, null, null, null, 1, null, false, 23, 'Τα ελληνικά POS τρέχουν 1,2–1,8%.'),
  ('4star_lean', 'pct_of_revenue', 'POS και τραπεζικά', null, 0.015, null, null, null, null, null, null, 1, null, false, 23, 'Τα ελληνικά POS τρέχουν 1,2–1,8%.'),
  ('4star_full', 'fixed_annual', 'Ενέργεια, νερό, κοινόχρηστα', 60000.00, null, null, null, null, null, null, null, 1, null, true, 30, '60.000 καθαρά, χωρίς ΦΠΑ. 2.857 € ανά κλειδί.'),
  ('4star_lean', 'fixed_annual', 'Ενέργεια, νερό, κοινόχρηστα', 60000.00, null, null, null, null, null, null, null, 1, null, true, 30, '60.000 καθαρά, χωρίς ΦΠΑ. 2.857 € ανά κλειδί.'),
  ('4star_full', 'fixed_annual', 'Πρώτες ύλες πρωινού', 40000.00, null, null, null, null, null, null, null, 1, null, true, 31, '~4,5 € ανά άτομο. Η σύνθεση ορίζεται από τον νόμο (κριτήριο 7.5).'),
  ('4star_lean', 'fixed_annual', 'Πρώτες ύλες πρωινού', 40000.00, null, null, null, null, null, null, null, 1, null, true, 31, '~4,5 € ανά άτομο. Η σύνθεση ορίζεται από τον νόμο (κριτήριο 7.5).'),
  ('4star_full', 'fixed_annual', 'Λινά, amenities, αναλώσιμα', 52000.00, null, null, null, null, null, null, null, 1, null, true, 32, '11,71 € ανά διανυκτέρευση.'),
  ('4star_lean', 'fixed_annual', 'Λινά, amenities, αναλώσιμα', 52000.00, null, null, null, null, null, null, null, 1, null, true, 32, '11,71 € ανά διανυκτέρευση.'),
  ('4star_full', 'fixed_annual', 'Εστιατόριο & μπαρ', 18000.00, null, null, null, null, null, null, null, 1, null, true, 33, 'ΥΠΟΧΡΕΩΤΙΚΑ — κριτήρια 7.3 και 7.10.'),
  ('4star_lean', 'fixed_annual', 'Εστιατόριο & μπαρ', 18000.00, null, null, null, null, null, null, null, 1, null, true, 33, 'ΥΠΟΧΡΕΩΤΙΚΑ — κριτήρια 7.3 και 7.10.'),
  ('4star_full', 'fixed_annual', 'Μάρκετινγκ & booking engine', 23000.00, null, null, null, null, null, null, null, 1, null, true, 34, 'Google Hotel Ads 8.000, booking engine 2.400, πρόγραμμα επαναλαμβανόμενων 3.000, λοιπή προβολή 9.600.'),
  ('4star_lean', 'fixed_annual', 'Μάρκετινγκ & booking engine', 23000.00, null, null, null, null, null, null, null, 1, null, true, 34, 'Google Hotel Ads 8.000, booking engine 2.400, πρόγραμμα επαναλαμβανόμενων 3.000, λοιπή προβολή 9.600.'),
  ('4star_full', 'fixed_annual', 'Ασφάλιση', 9000.00, null, null, null, null, null, null, null, 1, null, true, 35, 'Αστική ευθύνη, πυρός, περιεχομένου. Για 21 σουίτες χωρίς πισίνα.'),
  ('4star_lean', 'fixed_annual', 'Ασφάλιση', 9000.00, null, null, null, null, null, null, null, 1, null, true, 35, 'Αστική ευθύνη, πυρός, περιεχομένου. Για 21 σουίτες χωρίς πισίνα.'),
  ('4star_full', 'fixed_annual', 'Λογιστικά & νομικά', 8000.00, null, null, null, null, null, null, null, 1, null, true, 36, null),
  ('4star_lean', 'fixed_annual', 'Λογιστικά & νομικά', 8000.00, null, null, null, null, null, null, null, 1, null, true, 36, null),
  ('4star_lean', 'fixed_annual', 'Εξωτερική συντήρηση', 14000.00, null, null, null, null, null, null, null, 1, null, true, 37, 'Αντικαθιστά τον μόνιμο τεχνικό στη βελτιστοποιημένη.')
  ) as v(scenario_code, kind, label, annual, pct, headcount, wage, salaries, efka,
         premium, months, from_y, to_y, grows, sort_order, note)
where v.scenario_code = sc.code;

-- ── Assumptions the workbook itself flags as unconfirmed ───────────────────
insert into project_notes (org_id, project_id, kind, severity, body, sort_order)
select p.org_id, p.id, v.kind::project_note_kind, v.sev::project_note_severity, v.body, v.so
from projects p, (values
  ('risk', 'watch',
   'Το επιτόκιο του Δανείου Β (3,5%) και η κατανομή των επιπλέον 400.000 σε αυτό δεν έχουν επιβεβαιωθεί με την τράπεζα.', 1),
  ('risk', 'watch',
   'Οι τρεις ημερομηνίες εκταμίευσης (11/2026, 02/2027, 05/2027) είναι παραδοχή αναλογική με τις φάσεις κατασκευής, όχι συμφωνημένο χρονοδιάγραμμα.', 2),
  ('status', 'info',
   'Η δεσμευμένη εγγύηση των 400.000 δεσμεύεται, δεν ξοδεύεται — παύει όμως να είναι ρευστή.', 3),
  ('risk', 'watch',
   'Το μοντέλο δεν περιλαμβάνει αποθεματικό ανανέωσης εξοπλισμού (FF&E). Για 21 σουίτες σε 23 έτη αυτό υπερεκτιμά τη σωρευτική ταμειακή ροή.', 4)
) as v(kind, sev, body, so)
where p.code = 'Q003_LAZARAKI32_GLYFADA';

commit;