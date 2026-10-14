// The Επισκόπηση (/dashboard) model, in the order of the workbook's
// «Κέντρο Ελέγχου» / «Πληρωμές»: Ρευστότητα per account, the four Θέση ΦΠΑ
// figures, the obligations due in the next 30 days and the project portfolio. The page passes raw rows from its queries; labels, formatting
// and hrefs live here. Pure, so vitest covers it.
import { figureLength, formatDate, formatMoney } from "@/lib/format";
import { addDays, monthKeyOf, monthLabel } from "@/lib/dates";
import { PNL_LINES } from "@/lib/finance/pnl";
import { portfolioRows, type PortfolioRollupRow } from "@/lib/finance/portfolio";

// One Ρευστότητα figure: a liquid account, or «Σύνολο ρευστών» (total).
export interface GlanceFigure {
  key: string;
  label: string;
  value: string;
  href: string;
  negative: boolean;
  total: boolean;
  // 1 = short figure (full size), 2 = medium, 3 = long (millions): the page
  // steps the font down so a figure never overflows its cell.
  length: 1 | 2 | 3;
}

// The small line under the figures: the 12-month low and the year's result.
export interface GlanceLine {
  label: string;
  value: string;
  sub: string | null;
  href: string;
  negative: boolean;
}

export interface LiquidAccountRow {
  account_id: string | null;
  name: string | null;
  current_balance: number | string | null;
  // false: closed. Shown only while it still holds money.
  active?: boolean;
}

export interface OverviewInputs {
  // Liquid accounts (v_account_balances where is_liquid), in display order.
  // Same balance rule as v_liquidity, so the total is the same number.
  accounts: LiquidAccountRow[];
  // The lowest month of the 12-month cash_forecast(), or null without one.
  lowest: { month: string; closing_balance: number | string | null; below_buffer: boolean | null } | null;
  // That month's single largest outflow (cash_forecast_items): why it is low.
  lowestDriver?: { label: string | null; amount: number | string | null } | null;
  year: number;
  pnlRows: { line: string; amount: number | string | null }[];
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

// As in late September: one figure per liquid account (each the link to its
// transactions) and «Σύνολο ρευστών»; the 12-month low and the year's result
// as one small line under them.
export function overviewGlance(i: OverviewInputs): { figures: GlanceFigure[]; lowest: GlanceLine; pnl: GlanceLine } {
  const shown = i.accounts.filter((a) => a.account_id && (a.active !== false || round2(num(a.current_balance)) !== 0));
  const total = round2(i.accounts.reduce((s, a) => s + num(a.current_balance), 0));
  const figures: Omit<GlanceFigure, "length">[] = [
    ...shown.map((a) => ({
      key: a.account_id!,
      label: a.name?.trim() || "—",
      value: formatMoney(num(a.current_balance)),
      href: `/transactions?account_id=${a.account_id}`,
      negative: num(a.current_balance) < 0,
      total: false,
    })),
    { key: "total", label: "Σύνολο ρευστών", value: formatMoney(total), href: "/accounts", negative: total < 0, total: true },
  ];

  const result = pnlResult(i.pnlRows);
  const lowestBalance = i.lowest ? num(i.lowest.closing_balance) : null;
  const driver =
    i.lowestDriver?.label && num(i.lowestDriver.amount) > 0
      ? `κυρίως: ${i.lowestDriver.label} −${formatMoney(num(i.lowestDriver.amount))}`
      : null;

  return {
    figures: figures.map((f) => ({ ...f, length: figureLength(f.value) })),
    lowest: {
      label: "Χαμηλότερο σημείο 12μ",
      value: lowestBalance === null ? "—" : formatMoney(lowestBalance),
      sub: i.lowest ? [monthLabel(monthKeyOf(i.lowest.month)), driver].filter(Boolean).join(" · ") : "χωρίς πρόβλεψη",
      // Straight to the low month's breakdown in Ταμείο & Πρόβλεψη.
      href: i.lowest ? `/reports/cash?month=${monthKeyOf(i.lowest.month)}` : "/reports/cash",
      negative: Boolean(i.lowest?.below_buffer) || (lowestBalance ?? 0) < 0,
    },
    pnl: {
      label: `Αποτέλεσμα ${i.year} ως σήμερα`,
      value: formatMoney(result),
      sub: null,
      href: "/reports/pnl",
      negative: result < 0,
    },
  };
}

// ── «Βγαίνει το πλάνο;»: the answer first, from the 12-month cash_forecast() ──
export interface ForecastMonth {
  month: string;
  closing_balance: number | string | null;
  min_buffer?: number | string | null;
  below_buffer: boolean | null;
}

export interface PlanVerdict {
  // ok: never under the safety buffer · tight: under it, never below zero ·
  // short: below zero at some point.
  tone: "ok" | "tight" | "short";
  title: string;
  detail: string;
  // That month's largest outflow, for the hover.
  why: string | null;
  href: string;
}

export function planVerdict(forecast: ForecastMonth[], driver?: OverviewInputs["lowestDriver"]): PlanVerdict | null {
  if (forecast.length === 0) return null;
  const lowest = forecast.reduce((min, m) => (num(m.closing_balance) < num(min.closing_balance) ? m : min));
  const low = num(lowest.closing_balance);
  const lowMonth = monthLabel(monthKeyOf(lowest.month));
  const firstNegative = forecast.find((m) => num(m.closing_balance) < 0);
  const firstBelow = forecast.find((m) => m.below_buffer);
  const why =
    driver?.label && num(driver.amount) > 0 ? `κυρίως: ${driver.label} −${formatMoney(num(driver.amount))}` : null;
  const href = `/reports/cash?month=${monthKeyOf(lowest.month)}`;
  if (firstNegative) {
    return {
      tone: "short",
      title: `Δεν βγαίνει — τα χρήματα τελειώνουν ${monthLabel(monthKeyOf(firstNegative.month))}`,
      detail: `Χαμηλότερο σημείο ${formatMoney(low)} · ${lowMonth}`,
      why,
      href,
    };
  }
  if (firstBelow) {
    const buffer = num(firstBelow.min_buffer);
    return {
      tone: "tight",
      title: "Βγαίνει — αλλά στενεύει",
      detail: `Κάτω από το απόθεμα ασφαλείας${buffer > 0 ? ` (${formatMoney(buffer)})` : ""} από ${monthLabel(monthKeyOf(firstBelow.month))} · χαμηλότερο ${formatMoney(low)} · ${lowMonth}`,
      why,
      href,
    };
  }
  return { tone: "ok", title: "Βγαίνει το πλάνο", detail: `Χαμηλότερο σημείο 12 μηνών ${formatMoney(low)} · ${lowMonth}`, why, href };
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
export const UPCOMING_MAX = 6;

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
  capex_paid: number | string | null;
  capex_committed: number | string | null;
  vat_on_expenses: number | string | null;
}

export interface DashboardPortfolioRow {
  id: string;
  name: string;
  // null: no budget on file («—»).
  budget: number | null;
  // Capex paid, and committed (pending + scheduled): what consumes a budget
  // (0020). The same v_project_rollup columns as the project page's
  // ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ and the projects list, so budget − paid − committed =
  // remaining on all three.
  paid: number;
  committed: number;
  vat: number;
  // remaining_budget; null with no budget.
  remaining: number | null;
  overBudget: boolean;
}

export const PORTFOLIO_MAX = 8;

// Projects with a budget or capex on them, largest budget first
// (portfolioRows' order, cancelled ones left out); the rest counted for
// «όλα (N) →».
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
        paid: round2(num(r?.capex_paid)),
        committed: round2(num(r?.capex_committed)),
        vat: round2(num(r?.vat_on_expenses)),
        remaining: p.budget > 0 ? p.remaining : null,
        overBudget: p.overBudget,
      };
    })
    .filter((p) => p.budget !== null || p.paid !== 0 || p.committed !== 0);
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

// ── ΦΠΑ: one line, the next payable and its deadline ──
export interface VatPositionRow {
  period_start: string | null;
  payable_after_credit: number | string | null;
  credit_balance?: number | string | null;
  filing_deadline?: string | null;
  vat_income?: number | string | null;
  vat_expense?: number | string | null;
}

export interface VatNext {
  payable: number;
  sub: string;
}

// The earliest period not yet filed whose deadline is still ahead: its
// payable and «period · έως deadline». Without one, zero and the current
// credit (or nothing pending).
export function vatNext(rows: VatPositionRow[], filed: Set<string>, today: string): VatNext {
  const next = rows
    .filter((r) => r.period_start && !filed.has(r.period_start) && r.filing_deadline && r.filing_deadline >= today)
    .sort((a, b) => a.filing_deadline!.localeCompare(b.filing_deadline!))[0];
  if (next) {
    const payable = Math.max(0, num(next.payable_after_credit));
    const period = monthLabel(monthKeyOf(next.period_start!));
    return { payable, sub: `${period} · έως ${formatDate(next.filing_deadline)}${payable > 0 ? "" : ", χωρίς πληρωμή"}` };
  }
  const latest = rows
    .filter((r) => r.period_start)
    .sort((a, b) => b.period_start!.localeCompare(a.period_start!))[0];
  const credit = Math.abs(num(latest?.credit_balance));
  return { payable: 0, sub: credit > 0 ? `Καμία προθεσμία · πιστωτικό ${formatMoney(credit)}` : "Καμία προθεσμία σε εκκρεμότητα" };
}

// ── Θέση ΦΠΑ: the four September figures ──
export interface VatPosition {
  // Summed over every period so far: real per-period flows, an honest total.
  output: number;
  input: number;
  // As of the latest period: the running balance already carries every
  // earlier period forward, so summing these would double count.
  credit: number;
  owed: number;
  // The earliest period, for the «σύνολο» links; null with no periods.
  from: string | null;
}

// `rows`: v_vat_position up to today, any order. null with no rows.
export function vatPosition(rows: VatPositionRow[]): VatPosition | null {
  const periods = rows.filter((r) => r.period_start).sort((a, b) => a.period_start!.localeCompare(b.period_start!));
  if (periods.length === 0) return null;
  const latest = periods[periods.length - 1];
  return {
    output: round2(periods.reduce((s, r) => s + num(r.vat_income), 0)),
    input: round2(periods.reduce((s, r) => s + num(r.vat_expense), 0)),
    credit: round2(Math.abs(num(latest.credit_balance))),
    owed: round2(num(latest.payable_after_credit)),
    from: periods[0].period_start,
  };
}
