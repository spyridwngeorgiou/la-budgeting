// The eight tiles at the top of the Αρχική: one per area, each with its key
// number and a link to where that number comes from. The page passes raw
// numbers from its existing queries; labels, formatting and hrefs live here.
// Pure, so vitest covers it.
import { formatMoney } from "@/lib/format";
import { monthKeyOf, monthLabel } from "@/lib/dates";
import { PNL_LINES } from "@/lib/finance/pnl";

export interface DashboardTile {
  key: "cash" | "forecast" | "inbox" | "calendar" | "pnl" | "vat" | "openItems" | "projects";
  eyebrow: string;
  value: string;
  sub: string;
  href: string;
  negative: boolean;
}

export interface TileInputs {
  cashCorporate: number;
  cashPersonal: number;
  // The lowest month of the 12-month cash_forecast(), or null without one.
  lowest: { month: string; closing_balance: number | string | null; below_buffer: boolean | null } | null;
  inboxPending: number;
  calendarNext7: number;
  year: number;
  pnlRows: { line: string; amount: number | string | null }[];
  vatPayable: number;
  receivables: number;
  payables: number;
  activeProjects: number;
  overBudgetProjects: number;
}

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const count = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

// Same total as the «Αποτέλεσμα» row of /reports/pnl (pnlTable): every
// pnl_line() line summed, signed. Unknown lines are ignored there too.
export function pnlResult(rows: TileInputs["pnlRows"]): number {
  const lines = new Set<string>(PNL_LINES);
  const sum = rows.filter((r) => lines.has(r.line)).reduce((s, r) => s + num(r.amount), 0);
  return Math.round(sum * 100) / 100;
}

export function dashboardTiles(i: TileInputs): DashboardTile[] {
  const inbox = count(i.inboxPending);
  const calendar = count(i.calendarNext7);
  const active = count(i.activeProjects);
  const over = count(i.overBudgetProjects);
  const result = pnlResult(i.pnlRows);
  const lowestBalance = i.lowest ? num(i.lowest.closing_balance) : null;

  return [
    {
      key: "cash",
      eyebrow: "Ταμείο",
      value: formatMoney(i.cashCorporate + i.cashPersonal),
      sub: `Εταιρικό ${formatMoney(i.cashCorporate)} · Προσωπικό ${formatMoney(i.cashPersonal)}`,
      href: "/accounts",
      negative: i.cashCorporate + i.cashPersonal < 0,
    },
    {
      key: "forecast",
      eyebrow: "Πρόβλεψη",
      value: lowestBalance === null ? "—" : formatMoney(lowestBalance),
      sub: i.lowest ? `Χαμηλότερο 12μ. · ${monthLabel(monthKeyOf(i.lowest.month))}` : "Χωρίς πρόβλεψη",
      href: "/reports/cash",
      negative: Boolean(i.lowest?.below_buffer) || (lowestBalance ?? 0) < 0,
    },
    {
      key: "inbox",
      eyebrow: "Εισερχόμενα",
      value: String(inbox),
      sub: inbox === 0 ? "Τίποτα προς έλεγχο" : "προς έλεγχο",
      href: "/inbox",
      negative: false,
    },
    {
      key: "calendar",
      eyebrow: "Ημερολόγιο",
      value: String(calendar),
      sub: `${calendar === 1 ? "εγγραφή" : "εγγραφές"} τις επόμενες 7 ημέρες`,
      href: "/calendar",
      negative: false,
    },
    {
      key: "pnl",
      eyebrow: "Αποτέλεσμα",
      value: formatMoney(result),
      sub: `${i.year} ως σήμερα`,
      href: "/reports/pnl",
      negative: result < 0,
    },
    {
      key: "vat",
      eyebrow: "ΦΠΑ",
      value: formatMoney(i.vatPayable),
      sub: "οφειλόμενο",
      href: "/reports/vat",
      negative: false,
    },
    {
      key: "openItems",
      eyebrow: "Απαιτήσεις / Υποχρεώσεις",
      value: `+${formatMoney(Math.abs(i.receivables))}`,
      sub: `−${formatMoney(Math.abs(i.payables))} υποχρεώσεις`,
      href: "/transactions?status=pending",
      negative: false,
    },
    {
      key: "projects",
      eyebrow: "Έργα",
      value: String(active),
      sub: `${active === 1 ? "ενεργό" : "ενεργά"} · ${over} εκτός προϋπολογισμού`,
      href: "/projects",
      negative: false,
    },
  ];
}
