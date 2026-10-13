// The Επισκόπηση (/dashboard) model, in the 7/10 order of the workbook's
// «Κέντρο Ελέγχου» / «Πληρωμές»: the four Ρευστότητα figures, the
// obligations due in the next 30 days, the project portfolio and the one
// ΦΠΑ line. The page passes raw rows from its queries; labels, formatting
// and hrefs live here. Pure, so vitest covers it.
import { figureLength, formatDate, formatMoney } from "@/lib/format";
import { addDays, monthKeyOf, monthLabel } from "@/lib/dates";
import { PNL_LINES } from "@/lib/finance/pnl";
import { portfolioRows, type PortfolioRollupRow } from "@/lib/finance/portfolio";

export interface GlanceFigure {
  key: "cash" | "lowest" | "pnl" | "vat";
  label: string;
  value: string;
  sub: string;
  href: string;
  negative: boolean;
  // 1 = short figure (full size), 2 = medium, 3 = long (millions): the page
  // steps the font down so a figure never overflows its quarter.
  length: 1 | 2 | 3;
}

export interface OverviewInputs {
  cashCorporate: number;
  cashPersonal: number;
  // The lowest month of the 12-month cash_forecast(), or null without one.
  lowest: { month: string; closing_balance: number | string | null; below_buffer: boolean | null } | null;
  // That month's single largest outflow (cash_forecast_items): why it is low.
  lowestDriver?: { label: string | null; amount: number | string | null } | null;
  year: number;
  pnlRows: { line: string; amount: number | string | null }[];
  vatPayable: number;
}

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

// Same total as the «Αποτέλεσμα» row of /reports/pnl (pnlTable): every
// pnl_line() line summed, signed. Unknown lines are ignored there too.
export function pnlResult(rows: OverviewInputs["pnlRows"]): number {
  const lines = new Set<string>(PNL_LINES);
  const sum = rows.filter((r) => lines.has(r.line)).reduce((s, r) => s + num(r.amount), 0);
  return round2(sum);
}

// «1.250,00 €» is 10 characters, «12.345,67 €» 11, «-1.234.567,89 €» 15.
export { figureLength };

export function overviewGlance(i: OverviewInputs): GlanceFigure[] {
  const cash = i.cashCorporate + i.cashPersonal;
  const result = pnlResult(i.pnlRows);
  const lowestBalance = i.lowest ? num(i.lowest.closing_balance) : null;
  const driver =
    i.lowestDriver?.label && num(i.lowestDriver.amount) > 0
      ? `κυρίως: ${i.lowestDriver.label} −${formatMoney(num(i.lowestDriver.amount))}`
      : null;

  const figures: Omit<GlanceFigure, "length">[] = [
    {
      key: "cash",
      label: "Ταμείο τώρα",
      value: formatMoney(cash),
      sub: `Εταιρικό ${formatMoney(i.cashCorporate)} · Προσωπικό ${formatMoney(i.cashPersonal)}`,
      href: "/accounts",
      negative: cash < 0,
    },
    {
      key: "lowest",
      label: "Χαμηλότερο σημείο 12μ",
      value: lowestBalance === null ? "—" : formatMoney(lowestBalance),
      sub: i.lowest
        ? [monthLabel(monthKeyOf(i.lowest.month)), driver].filter(Boolean).join(" · ")
        : "Χωρίς πρόβλεψη",
      // Straight to the low month's breakdown in Ταμείο & Πρόβλεψη.
      href: i.lowest ? `/reports/cash?month=${monthKeyOf(i.lowest.month)}` : "/reports/cash",
      negative: Boolean(i.lowest?.below_buffer) || (lowestBalance ?? 0) < 0,
    },
    {
      key: "pnl",
      label: "Αποτέλεσμα έτους ως σήμερα",
      value: formatMoney(result),
      sub: `1 Ιανουαρίου – σήμερα, ${i.year}`,
      href: "/reports/pnl",
      negative: result < 0,
    },
    {
      key: "vat",
      label: "ΦΠΑ οφειλόμενο",
      value: formatMoney(i.vatPayable),
      sub: "Τρέχουσα περίοδος, μετά το πιστωτικό",
      href: "/reports/vat",
      negative: false,
    },
  ];
  return figures.map((f) => ({ ...f, length: figureLength(f.value) }));
}

// ── Προσεχείς υποχρεώσεις: pending/scheduled rows due in the next 30 days ──
export interface OpenTxRow {
  id: string;
  due_date: string | null;
  status: string | null;
  direction: string | null;
  gross_amount: number | string | null;
  description: string | null;
  counterparty_name: string | null;
}

export interface UpcomingItem {
  id: string;
  date: string;
  label: string;
  // Signed: income +, everything else −.
  amount: number;
}

export const UPCOMING_DAYS = 30;
export const UPCOMING_MAX = 8;

// Today through today + 29, soonest first (overdue rows belong to
// «Χρειάζεται προσοχή», not this list). The rest is counted, never dropped.
export function upcomingObligations(
  rows: OpenTxRow[],
  today: string,
  max = UPCOMING_MAX,
): { shown: UpcomingItem[]; more: number; income: number; outflow: number } {
  const end = addDays(today, UPCOMING_DAYS - 1);
  const all = rows
    .filter((r) => r.due_date && r.due_date >= today && r.due_date <= end)
    .map((r) => ({
      id: r.id,
      date: r.due_date!,
      label: r.description?.trim() || r.counterparty_name?.trim() || "—",
      amount: (r.direction === "income" ? 1 : -1) * Math.abs(num(r.gross_amount)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "el"));
  return {
    shown: all.slice(0, max),
    more: Math.max(0, all.length - max),
    income: round2(all.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0)),
    outflow: round2(all.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0)),
  };
}

// ── Χαρτοφυλάκιο έργων: the 7/10 table, from lib/finance/portfolio ──
export interface DashboardRollupRow extends PortfolioRollupRow {
  pending: number | string | null;
  vat_on_expenses: number | string | null;
}

export interface DashboardPortfolioRow {
  id: string;
  name: string;
  // null: no budget on file («—»).
  budget: number | null;
  spent: number;
  pending: number;
  vat: number;
  overBudget: boolean;
}

export const PORTFOLIO_MAX = 8;

// Projects with something on them (a budget, a spend or a pending bill),
// largest budget first (portfolioRows' order, cancelled ones left out); the
// rest counted for «όλα (N) →».
export function dashboardPortfolio(
  rollup: DashboardRollupRow[],
  max = PORTFOLIO_MAX,
): { shown: DashboardPortfolioRow[]; more: number } {
  const extra = new Map(rollup.map((r) => [r.project_id, r]));
  const all = portfolioRows(rollup)
    .map((p) => {
      const r = extra.get(p.id);
      return {
        id: p.id,
        name: p.name,
        budget: p.budget > 0 ? p.budget : null,
        spent: p.spent,
        pending: round2(num(r?.pending)),
        vat: round2(num(r?.vat_on_expenses)),
        overBudget: p.overBudget,
      };
    })
    .filter((p) => p.budget !== null || p.spent !== 0 || p.pending !== 0);
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

// ── ΦΠΑ: one line, the next payable and its deadline ──
export interface VatPositionRow {
  period_start: string | null;
  payable_after_credit: number | string | null;
  credit_balance?: number | string | null;
  filing_deadline?: string | null;
}

// The earliest period not yet filed whose deadline is still ahead; without
// one, the current credit (or nothing pending).
export function vatLine(rows: VatPositionRow[], filed: Set<string>, today: string): string {
  const next = rows
    .filter((r) => r.period_start && !filed.has(r.period_start) && r.filing_deadline && r.filing_deadline >= today)
    .sort((a, b) => a.filing_deadline!.localeCompare(b.filing_deadline!))[0];
  if (next) {
    const payable = num(next.payable_after_credit);
    const period = monthLabel(monthKeyOf(next.period_start!));
    return payable > 0
      ? `Επόμενο πληρωτέο ${formatMoney(payable)} έως ${formatDate(next.filing_deadline)} (${period})`
      : `Υποβολή ${period} έως ${formatDate(next.filing_deadline)}, χωρίς πληρωμή`;
  }
  const latest = rows
    .filter((r) => r.period_start)
    .sort((a, b) => b.period_start!.localeCompare(a.period_start!))[0];
  const credit = Math.abs(num(latest?.credit_balance));
  return credit > 0
    ? `Καμία προθεσμία σε εκκρεμότητα · πιστωτικό ${formatMoney(credit)}`
    : "Καμία προθεσμία σε εκκρεμότητα";
}
