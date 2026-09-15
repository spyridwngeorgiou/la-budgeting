-- 0201: Q004 AADE settlement plans
--
-- The three ρυθμίσεις the company services INSTEAD of paying rent to the
-- landlords of Αγ. Κωνσταντίνου 20 (Q004): 636,04 + 723,93 + 714,28 =
-- 2.074,25 τον μήνα, from the Optima Εταιρικός account.
--
-- No dates are guessed. The ledger already carried each settlement as a single
-- pending row dated late July 2026, and that start reconciles three ways:
--   * 16 instalments from Jul-2026 end Oct-2027 -- the workbook says «λήγει
--     Οκτώβριο 2027»
--   * with two instalments paid per plan at the workbook's Sept-2026 snapshot,
--     the remaining balance is 70×636,04 + 22×723,93 + 14×714,28 = 70.449,18,
--     against the workbook's stated 70.449
--
-- Those existing rows are ADOPTED as instalment #1 of their plan rather than
-- left beside it, so regenerate_plan() updates them instead of creating a
-- duplicate first instalment.
--
-- They are also RECLASSIFIED from «Φόροι & Ρυθμίσεις» (tax) to «Ρυθμίσεις ΑΑΔΕ
-- αντί μισθώματος» (rent_substitute). That single change is what stops these
-- 70.449 being counted as renovation commitments -- the Q004 workbook's
-- phantom −71.019 overrun.

begin;

with ctx as (
  select
    (select id from projects   where code = 'Q004_AGIOU_KWNSTANTINOU20_GLYFADA') as project_id,
    (select org_id from projects where code = 'Q004_AGIOU_KWNSTANTINOU20_GLYFADA') as org_id,
    (select id from accounts   where name = 'Optima Εταιρικός')                   as account_id,
    (select id from categories where code = 'ΡΥΘΜΊΣΕΙΣ_ΑΝΤΊ_ΜΙΣΘΏΜΑΤΟΣ')         as category_id
)
insert into installment_plans (
  org_id, label, direction, scope, project_id, category_id, account_id,
  amount_per_installment, frequency, first_due_date, installment_count,
  obligation_kind, status, notes
)
select ctx.org_id, v.label, 'expense', 'business', ctx.project_id, ctx.category_id, ctx.account_id,
       v.amount, 'monthly', v.first_due::date, v.count_n,
       'third_party_tax_settlement', 'active', v.note
from ctx, (values
  ('Ρύθμιση ΑΑΔΕ Α/Α 9273853', 636.04, 72, '2026-07-27',
   'Υποχρέωση ιδιοκτητών που εξυπηρετείται αντί μισθώματος. Ημερομηνία έναρξης από την υπάρχουσα κίνηση του καθολικού.'),
  ('Ρύθμιση ΑΑΔΕ Α/Α 9283760', 723.93, 24, '2026-07-29',
   'Υποχρέωση ιδιοκτητών που εξυπηρετείται αντί μισθώματος. Ημερομηνία έναρξης από την υπάρχουσα κίνηση του καθολικού.'),
  ('Ρύθμιση ΑΑΔΕ Α/Α 9271572', 714.28, 16, '2026-07-31',
   'Υποχρέωση ιδιοκτητών που εξυπηρετείται αντί μισθώματος. Λήγει Οκτώβριο 2027, όπως αναφέρει το Q004_ΑγΚωνσταντίνου.xlsx. Προκαταβολή 1.428,56 (δύο δόσεις) πληρώθηκε 22/06/2026.')
) as v(label, amount, count_n, first_due, note)
on conflict do nothing;

-- Adopt the pre-existing ledger rows as instalment #1 of the matching plan,
-- and reclassify them. Matched on the Α/Α in the description AND the exact
-- date -- the Α/Α alone also matches the June προκαταβολή row for 9271572,
-- which is a separate, already-paid advance and must not be adopted as an
-- instalment.
update transactions t
set plan_id        = p.id,
    installment_no = 1,
    category_id    = p.category_id
from installment_plans p
where p.obligation_kind = 'third_party_tax_settlement'
  and t.plan_id is null
  and t.project_id = p.project_id
  and t.tx_date = p.first_due_date
  and t.description like '%' || substring(p.label from 'Α/Α [0-9]+') || '%';

commit;

-- Generate instalments 2..n. Paid/invoiced/documented rows are protected by
-- regenerate_plan() itself, so this is safe to re-run.
select p.label, r.generated_count, r.protected_count
from installment_plans p
cross join lateral regenerate_plan(p.id) r
where p.obligation_kind = 'third_party_tax_settlement';
