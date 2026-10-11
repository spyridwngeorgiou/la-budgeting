// The one-sentence conclusion at the top of each report tab
// (components/ui/ReportSection: ReportHeadline), written from the tab's own
// figures -- fixed Greek phrases, no AI. Pure functions on plain inputs, so
// each page passes what it already computed. Amounts are compact («−1,2
// εκ. €», true minus), percentages through lib/format.

import { formatCompactMoney, formatDate, formatNumber, formatPercent } from "@/lib/format";

// Accusative month names: «τον Σεπτέμβριο 2027».
const MONTHS_ACC = [
  "Ιανουάριο",
  "Φεβρουάριο",
  "Μάρτιο",
  "Απρίλιο",
  "Μάιο",
  "Ιούνιο",
  "Ιούλιο",
  "Αύγουστο",
  "Σεπτέμβριο",
  "Οκτώβριο",
  "Νοέμβριο",
  "Δεκέμβριο",
];

// «2027-09» (or «2027-09-30») -> «τον Σεπτέμβριο 2027».
export function inMonth(monthKeyOrIso: string): string {
  const [y, m] = monthKeyOrIso.split("-");
  const name = MONTHS_ACC[Number(m) - 1];
  return name ? `τον ${name} ${y}` : monthKeyOrIso;
}

const money = formatCompactMoney;
const count = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

// ── Ταμείο & Πρόβλεψη: «Θα έχουμε λεφτά;» ─────────────────────────────────
export interface CashNarrativeInput {
  // The lowest closing balance in the horizon and its month («2027-09»).
  lowest: { amount: number; month: string };
  // What drives the dip most («την κατασκευή του Q003»), already in the
  // accusative, after «κυρίως από».
  driver?: string | null;
  // The first month under the safety buffer, if any.
  firstBelowBuffer?: string | null;
  buffer?: number | null;
  horizonMonths?: number;
}

export function cashNarrative({ lowest, driver, firstBelowBuffer, buffer, horizonMonths = 12 }: CashNarrativeInput): string {
  const because = driver ? `, κυρίως από ${driver}` : "";
  if (firstBelowBuffer) {
    const dip = `Το ταμείο πέφτει κάτω από το απόθεμα ασφαλείας ${inMonth(firstBelowBuffer)}`;
    return `${dip} και στο χαμηλότερο ${money(lowest.amount)} ${inMonth(lowest.month)}${because}.`;
  }
  if (lowest.amount < 0) {
    return `Το ταμείο πέφτει στο χαμηλότερο ${money(lowest.amount)} ${inMonth(lowest.month)}${because}.`;
  }
  const over = buffer ? "πάνω από το απόθεμα ασφαλείας" : "θετικό";
  return `Το ταμείο μένει ${over} τους επόμενους ${horizonMonths} μήνες· χαμηλότερο ${money(lowest.amount)} ${inMonth(lowest.month)}${because}.`;
}

// ── Αποτελέσματα: «Βγάζουμε λεφτά;» ───────────────────────────────────────
export interface PnlNarrativeInput {
  year: number;
  revenueYtd: number;
  resultYtd: number;
  // The same months of last year; null when there is no last year.
  resultLastYearYtd?: number | null;
}

export function pnlNarrative({ year, revenueYtd, resultYtd, resultLastYearYtd }: PnlNarrativeInput): string {
  const head = resultYtd >= 0 ? `Κέρδος ${money(resultYtd)}` : `Ζημία ${money(Math.abs(resultYtd))}`;
  const margin = revenueYtd > 0 ? ` (περιθώριο ${formatPercent(resultYtd / revenueYtd)})` : "";
  let vs = "";
  if (resultLastYearYtd != null && resultLastYearYtd !== 0) {
    const change = (resultYtd - resultLastYearYtd) / Math.abs(resultLastYearYtd);
    vs =
      Math.abs(change) < 0.005
        ? ", όσο και πέρσι"
        : `, ${formatPercent(Math.abs(change), { digits: 0 })} ${change > 0 ? "καλύτερα" : "χειρότερα"} από πέρσι`;
  } else if (resultLastYearYtd === 0) {
    vs = ", έναντι μηδενικού αποτελέσματος πέρσι";
  }
  return `${head} το ${year} έως τώρα${margin}${vs}.`;
}

// ── Καθαρή θέση: «Πόσα αξίζουμε;» ─────────────────────────────────────────
export interface NetWorthNarrativeInput {
  assets: number;
  liabilities: number;
}

export function netWorthNarrative({ assets, liabilities }: NetWorthNarrativeInput): string {
  const net = assets - liabilities;
  const leverage = assets > 0 ? `· οι υποχρεώσεις είναι το ${formatPercent(liabilities / assets, { digits: 0 })} της περιουσίας` : "";
  return `Καθαρή θέση ${money(net)}, από ${money(assets)} περιουσία και ${money(liabilities)} υποχρεώσεις${leverage}.`;
}

// ── ΦΠΑ: «Τι θα πληρώσουμε στην εφορία;» ──────────────────────────────────
export interface VatNarrativeInput {
  // Net position of the current period: > 0 payable, ≤ 0 nothing to pay.
  payable: number;
  // ISO date of the next deadline.
  deadline?: string | null;
  // A credit carried forward, as a positive amount.
  credit?: number | null;
}

export function vatNarrative({ payable, deadline, credit }: VatNarrativeInput): string {
  if (payable > 0) {
    const by = deadline ? ` έως ${formatDate(deadline)}` : "";
    return `Πληρωτέος ΦΠΑ ${money(payable)}${by} για την τρέχουσα περίοδο.`;
  }
  const carried = Math.max(credit ?? 0, -payable);
  return carried > 0
    ? `Δεν υπάρχει ΦΠΑ για πληρωμή· πιστωτικό υπόλοιπο ${money(carried)} μεταφέρεται.`
    : "Δεν υπάρχει ΦΠΑ για πληρωμή την τρέχουσα περίοδο.";
}

// ── Παρακράτηση: «Τι οφείλουμε από παρακρατήσεις;» ───────────────────────
export interface WithholdingNarrativeInput {
  // The latest month with a position («2026-10») and its amount.
  month: string | null;
  current: number;
  // Sum of the last 12 months (including `month`).
  last12: number;
}

export function withholdingNarrative({ month, current, last12 }: WithholdingNarrativeInput): string {
  if (!month) return "Δεν υπάρχουν ακόμα κινήσεις με παρακράτηση.";
  return `${capital(inMonth(month))} παρακρατήθηκαν ${money(current)}· ${money(last12)} στους τελευταίους 12 μήνες.`;
}

// ── Ποιότητα δεδομένων: «Μπορώ να εμπιστευτώ τα νούμερα;» ────────────────
export interface QualityNarrativeInput {
  passing: number;
  total: number;
  // Open issues at the highest severity.
  urgent?: number;
}

// The trust index: checks passing / all checks (1 when there are none).
export function trustIndex(passing: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, passing / total)) : 1;
}

export function qualityNarrative({ passing, total, urgent = 0 }: QualityNarrativeInput): string {
  const index = formatPercent(trustIndex(passing, total), { digits: 0 });
  const tail = urgent > 0 ? `· ${count(urgent, "θέμα θέλει", "θέματα θέλουν")} άμεση προσοχή` : "· κανένα επείγον θέμα";
  if (total > 0 && passing >= total) return `Περνούν όλοι οι ${formatNumber(total)} έλεγχοι (δείκτης εμπιστοσύνης 100%)${tail}.`;
  return `Περνούν ${formatNumber(passing)} από ${formatNumber(total)} ελέγχους (δείκτης εμπιστοσύνης ${index})${tail}.`;
}

// ── Χαρτοφυλάκιο έργων: «Πώς πάνε οι επενδύσεις;» ────────────────────────
export interface PortfolioNarrativeInput {
  budget: number;
  spent: number;
  projects: number;
  overBudget: number;
}

export function portfolioNarrative({ budget, spent, projects, overBudget }: PortfolioNarrativeInput): string {
  const share = budget > 0 ? ` (${formatPercent(spent / budget, { digits: 0 })})` : "";
  const over =
    overBudget > 0 ? `· ${count(overBudget, "εκτός", "εκτός")} προϋπολογισμού` : projects > 1 ? "· όλα εντός προϋπολογισμού" : "· εντός προϋπολογισμού";
  return `Δαπανήθηκαν ${money(spent)} από ${money(budget)}${share} σε ${count(projects, "έργο", "έργα")}${over}.`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
