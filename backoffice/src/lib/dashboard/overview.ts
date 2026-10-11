// The Επισκόπηση (/dashboard) model: the four «Με μια ματιά» figures and
// the «Πού θέλετε να πάτε» destination cards, one per menu section in menu
// order. The page passes raw numbers from its existing queries; labels,
// formatting, hrefs and exceptions live here. Pure, so vitest covers it.
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { monthKeyOf, monthLabel } from "@/lib/dates";
import { PNL_LINES } from "@/lib/finance/pnl";

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

export type CardKey =
  | "inbox"
  | "assistant"
  | "transactions"
  | "accounts"
  | "reports"
  | "projects"
  | "planner"
  | "calendar"
  | "contacts";

export interface DestinationCard {
  key: CardKey;
  href: string;
  title: string;
  description: string;
  metric: string;
  // An exception the card should flag with its 2px bar, or null.
  severity: "urgent" | "attention" | null;
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
  // Viewers can't review, so the menu hides Εισερχόμενα; so does this.
  canReview: boolean;
  inboxPending: number;
  overdue: number;
  pending: number;
  accounts: number;
  accountDrift: number;
  activeProjects: number;
  overBudgetProjects: number;
  openTasks: number;
  calendarNext7: number;
  contacts: number;
}

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const count = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Same total as the «Αποτέλεσμα» row of /reports/pnl (pnlTable): every
// pnl_line() line summed, signed. Unknown lines are ignored there too.
export function pnlResult(rows: OverviewInputs["pnlRows"]): number {
  const lines = new Set<string>(PNL_LINES);
  const sum = rows.filter((r) => lines.has(r.line)).reduce((s, r) => s + num(r.amount), 0);
  return Math.round(sum * 100) / 100;
}

// «1.250,00 €» is 10 characters, «12.345,67 €» 11, «-1.234.567,89 €» 15.
export function figureLength(value: string): 1 | 2 | 3 {
  return value.length <= 11 ? 1 : value.length <= 13 ? 2 : 3;
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${formatMoney(n)}`;

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

export function overviewCards(i: OverviewInputs): DestinationCard[] {
  const inbox = count(i.inboxPending);
  const overdue = count(i.overdue);
  const pending = count(i.pending);
  const accounts = count(i.accounts);
  const drift = count(i.accountDrift);
  const active = count(i.activeProjects);
  const over = count(i.overBudgetProjects);
  const tasks = count(i.openTasks);
  const calendar = count(i.calendarNext7);
  const contacts = count(i.contacts);

  const cards: (DestinationCard | null)[] = [
    i.canReview
      ? {
          key: "inbox",
          href: "/inbox",
          title: el.nav.inbox,
          description: "Παραστατικά και προτάσεις AI προς έλεγχο",
          metric: inbox > 0 ? `${inbox} προς έλεγχο` : "Τίποτα προς έλεγχο",
          severity: inbox > 0 ? "attention" : null,
        }
      : null,
    {
      key: "assistant",
      href: "/assistant",
      title: el.nav.assistant,
      description: "Ερωτήσεις για τα οικονομικά σας, σε απλά ελληνικά",
      metric: "Ρωτήστε οτιδήποτε",
      severity: null,
    },
    {
      key: "transactions",
      href: "/transactions",
      title: el.nav.transactions,
      description: "Έσοδα, έξοδα, απαιτήσεις και υποχρεώσεις",
      metric:
        overdue > 0
          ? plural(overdue, "ληξιπρόθεσμη", "ληξιπρόθεσμες")
          : pending > 0
            ? plural(pending, "εκκρεμής", "εκκρεμείς")
            : "Καμία εκκρεμότητα",
      severity: overdue > 0 ? "urgent" : null,
    },
    {
      key: "accounts",
      href: "/accounts",
      title: el.nav.accounts,
      description: "Υπόλοιπα τραπεζών, ταμείων και καρτών",
      metric: [plural(accounts, "λογαριασμός", "λογαριασμοί"), drift > 0 ? plural(drift, "απόκλιση", "αποκλίσεις") : null]
        .filter(Boolean)
        .join(" · "),
      severity: drift > 0 ? "urgent" : null,
    },
    {
      key: "reports",
      href: "/reports",
      title: el.nav.reports,
      description: "Αποτελέσματα, ταμείο, ΦΠΑ και ανάλυση",
      metric: `Αποτέλεσμα ${signed(pnlResult(i.pnlRows))}`,
      severity: null,
    },
    {
      key: "projects",
      href: "/projects",
      title: el.nav.projects,
      description: "Προϋπολογισμός, δαπάνες και ορόσημα ανά έργο",
      metric: [plural(active, "ενεργό", "ενεργά"), over > 0 ? `${over} εκτός προϋπολογισμού` : null]
        .filter(Boolean)
        .join(" · "),
      severity: over > 0 ? "urgent" : null,
    },
    {
      key: "planner",
      href: "/planner",
      title: el.nav.planner,
      description: "Οι εργασίες όλων των έργων σε πίνακα",
      metric: tasks > 0 ? plural(tasks, "ανοιχτή εργασία", "ανοιχτές εργασίες") : "Καμία ανοιχτή εργασία",
      severity: null,
    },
    {
      key: "calendar",
      href: "/calendar",
      title: el.nav.calendar,
      description: "Πληρωμές, λήξεις και προθεσμίες ανά ημέρα",
      metric: calendar > 0 ? `${calendar} τις επόμενες 7 ημέρες` : "Τίποτα τις επόμενες 7 ημέρες",
      severity: null,
    },
    {
      key: "contacts",
      href: "/contacts",
      title: el.nav.contacts,
      description: "Πελάτες, προμηθευτές και συνεργάτες",
      metric: plural(contacts, "επαφή", "επαφές"),
      severity: null,
    },
  ];
  return cards.filter((c): c is DestinationCard => c !== null);
}
