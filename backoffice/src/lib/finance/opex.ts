// Operating cost lines (opex_lines, 0021) -> euros per operating year.
//
// The three kinds the table supports, each computed here and nowhere else:
//   fixed_annual    annual_amount
//   payroll         headcount × monthly wage × (1 + premium) × salaries per
//                   year × months active / 12, plus the employer's
//                   contributions on top. 14 salaries for 12 months is the
//                   Greek norm (δώρα + επίδομα αδείας); a seasonal post of 6
//                   months earns 7 of them.
//   pct_of_revenue  pct × that year's revenue -- kept separate so the cash
//                   flow can apply it month by month to the revenue curve
//
// A line applies from from_operating_year through to_operating_year; with
// no end year it applies for the rest of the horizon. (Until this module the
// cash flow only kept lines with from = to, so every open-ended line -- most
// of them -- silently fell out, and payroll and % lines counted 0.)
//
// Growth: a line with grows_with_opex_growth compounds opex_growth_pct per
// operating year after growth_starts_after_operating_year. % of revenue
// lines follow revenue instead and never compound on their own.
//
// Pure: no I/O.

export type OpexKind = "payroll" | "pct_of_revenue" | "fixed_annual";

export interface OpexLineInput {
  kind: OpexKind | string;
  label: string;
  note?: string | null;
  from_operating_year: number;
  to_operating_year: number | null;
  grows_with_opex_growth?: boolean | null;
  annual_amount?: number | string | null;
  headcount?: number | string | null;
  monthly_wage?: number | string | null;
  salaries_per_year?: number | string | null;
  employer_contribution_pct?: number | string | null;
  premium_pct?: number | string | null;
  months_active?: number | string | null;
  pct_of_revenue?: number | string | null;
}

export interface OpexGrowth {
  opexGrowthPct: number;
  growthStartsAfterOperatingYear: number;
}

const n = (v: number | string | null | undefined, fallback = 0) => {
  const x = Number(v ?? fallback);
  return Number.isFinite(x) ? x : fallback;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

export function isActiveIn(line: OpexLineInput, operatingYear: number): boolean {
  return line.from_operating_year <= operatingYear && (line.to_operating_year == null || line.to_operating_year >= operatingYear);
}

// Annual cost of one payroll line, before growth.
export function payrollAnnual(line: OpexLineInput): number {
  const gross =
    n(line.headcount) *
    n(line.monthly_wage) *
    (1 + n(line.premium_pct)) *
    n(line.salaries_per_year, 12) *
    (Math.min(12, Math.max(0, n(line.months_active, 12))) / 12);
  return round2(gross * (1 + n(line.employer_contribution_pct)));
}

function growthFactor(line: OpexLineInput, operatingYear: number, g: OpexGrowth): number {
  if (line.grows_with_opex_growth === false) return 1;
  const years = Math.max(0, operatingYear - g.growthStartsAfterOperatingYear);
  return Math.pow(1 + g.opexGrowthPct, years);
}

// The euro part of a line in an operating year (fixed and payroll); 0 for a
// % of revenue line or a year outside its range.
export function fixedPartOf(line: OpexLineInput, operatingYear: number, g: OpexGrowth): number {
  if (!isActiveIn(line, operatingYear)) return 0;
  if (line.kind === "payroll") return round2(payrollAnnual(line) * growthFactor(line, operatingYear, g));
  if (line.kind === "pct_of_revenue") return 0;
  return round2(n(line.annual_amount) * growthFactor(line, operatingYear, g));
}

// The share of revenue a line takes in an operating year (0 outside it).
export function pctPartOf(line: OpexLineInput, operatingYear: number): number {
  if (line.kind !== "pct_of_revenue" || !isActiveIn(line, operatingYear)) return 0;
  return n(line.pct_of_revenue);
}

// Per operating year 1..years: the euro amount of fixed + payroll lines and
// the summed % of revenue. This is what computeProjectCashflow consumes.
export function opexSchedule(
  lines: OpexLineInput[],
  years: number,
  g: OpexGrowth,
): { fixedAnnual: number[]; pctOfRevenue: number[] } {
  const fixedAnnual: number[] = [];
  const pctOfRevenue: number[] = [];
  for (let y = 1; y <= years; y++) {
    fixedAnnual.push(round2(lines.reduce((s, l) => s + fixedPartOf(l, y, g), 0)));
    pctOfRevenue.push(lines.reduce((s, l) => s + pctPartOf(l, y), 0));
  }
  return { fixedAnnual, pctOfRevenue };
}

// One operating year, line by line, for the ΛΕΙΤΟΥΡΓΙΑ block.
export function opexForYear(
  lines: OpexLineInput[],
  operatingYear: number,
  revenue: number,
  g: OpexGrowth,
): { lines: { label: string; note: string | null; amount: number }[]; total: number } {
  const out = lines
    .filter((l) => isActiveIn(l, operatingYear))
    .map((l) => ({
      label: l.label,
      note: l.note ?? null,
      amount: round2(fixedPartOf(l, operatingYear, g) + pctPartOf(l, operatingYear) * revenue),
    }));
  return { lines: out, total: round2(out.reduce((s, l) => s + l.amount, 0)) };
}
