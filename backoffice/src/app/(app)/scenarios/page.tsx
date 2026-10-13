import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/supabase/org";
import type { Flow, Lever, Pool } from "@/lib/finance/scenarios";
import { ScenarioPanel } from "./ScenarioPanel";

// Σενάρια -- 12 months of liquidity under switches the user flips, split into
// cash in hand and money in the banks. The page only gathers inputs;
// ScenarioPanel recomputes on every change in the browser.
//
// Inputs: today's balances per pool; every open (pending/scheduled) ledger row
// as a dated flow in its account's pool; expected income and large expected
// receipts as switchable inflows; rows tagged [ΠΡΟΒΛΕΨΗ] as switchable
// estimates; the bank loans (in application) as one switchable financing line.

const BIG_RECEIPT = 50000; // receipts at least this large get their own switch
const BIG_PAYMENT = 20000; // payments at least this large can be delayed
// Monthly personal spending from the workbook (Ρυθμίσεις!C31 cash, C33 card).
const PERSONAL = { cash: 5245, bank: 2255 };
// Recorded daily spending is complete from this month on (Καθημερινά).
const DAILY_FROM = "2026-08-01";

const poolOf = (kind: string | null | undefined): Pool => (kind === "cash" ? "cash" : "bank");
// Works the bank loan pays for: without the loan they do not happen.
const LOAN_PROJECTS = ["Q003_LAZARAKI32_GLYFADA"];
const LOAN_FUNDED = /^Κατασκευή/;
// A renovation's open phases: one switch per phase (cash + bank together),
// on by default, so the plan can be tested without it or moved later.
const RENOVATIONS: Record<string, string> = { Q004_AGIOU_KWNSTANTINOU20_GLYFADA: "Ανακαίνιση Αγ. Κωνσταντίνου" };
const RENOVATION_ROW = /^Ανακαίνιση/;
// The Lazaraki contract (προσύμφωνο, lawyers/notary, owners' ΕΝΦΙΑ, final
// contract): one switch per payment, on by default, so "what if it slips or
// does not happen" can be tested.
const CONTRACT = { project: "Q003_LAZARAKI32_GLYFADA", group: "Προσύμφωνο Λαζαράκη", row: /^(Προσύμφωνο|Δικηγόρ|ΕΝΦΙΑ ιδιοκτητών|Οριστικό συμβόλαιο)/ };

export default async function ScenariosPage() {
  const supabase = await createClient();
  const start = new Date().toISOString().slice(0, 7);
  const [org, { data: balances }, { data: open }, { data: expected }, { data: loans }, { data: loanProject }, { data: daily }] = await Promise.all([
    getCurrentOrg(supabase),
    supabase.from("v_account_balances").select("current_balance, is_liquid, kind"),
    supabase
      .from("transactions")
      .select("id, tx_date, due_date, direction, gross_amount, collection_probability, description, counterparty_name, notes, accounts(kind), projects(code), plan:installment_plans!transactions_plan_id_fkey(id, label, notes)")
      .in("status", ["pending", "scheduled"])
      .limit(5000),
    supabase.from("expected_income").select("id, source, amount, certainty, expected_month, creates_liability, notes"),
    supabase.from("loans").select("id, label, interest_rate, state, loan_drawdowns(scheduled_month, amount, actual_date)"),
    supabase.from("projects").select("display_name, opening_date").eq("code", LOAN_PROJECTS[0]).maybeSingle(),
    supabase
      .from("transactions")
      .select("paid_on, tx_date, gross_amount, accounts(kind)")
      .eq("scope", "personal").eq("status", "paid").eq("direction", "expense")
      .gte("paid_on", DAILY_FROM).lt("paid_on", `${start}-01`)
      .limit(5000),
  ]);

  // Daily spending per pool: monthly average and the heaviest month.
  const perMonth = new Map<string, { cash: number; bank: number }>();
  for (const d of daily ?? []) {
    const m = String(d.paid_on ?? d.tx_date).slice(0, 7);
    const account = Array.isArray(d.accounts) ? d.accounts[0] : d.accounts;
    const p = perMonth.get(m) ?? { cash: 0, bank: 0 };
    p[poolOf(account?.kind)] += Number(d.gross_amount);
    perMonth.set(m, p);
  }
  const monthsSeen = [...perMonth.values()];
  const dailyStats = monthsSeen.length
    ? {
        months: [...perMonth.keys()].sort(),
        average: { cash: Math.round(monthsSeen.reduce((s, p) => s + p.cash, 0) / monthsSeen.length), bank: Math.round(monthsSeen.reduce((s, p) => s + p.bank, 0) / monthsSeen.length) },
        highest: monthsSeen.reduce((a, b) => (b.cash + b.bank > a.cash + a.bank ? b : a)),
      }
    : null;
  const opening = { cash: 0, bank: 0 };
  for (const b of balances ?? []) if (b.is_liquid) opening[poolOf(b.kind)] += Number(b.current_balance ?? 0);
  const buffer = Number((org.settings as Record<string, unknown>)?.min_cash_buffer ?? 50000);

  const flows: Flow[] = [];
  const levers: Lever[] = [];
  const loanFunded: { id: string; month: string; amount: number; pool: Pool }[] = [];
  // Instalment plans tagged "[ΠΡΟΒΛΕΨΗ] <name>." are not activated yet: all
  // their instalments become one monthly switch named <name>.
  const series = new Map<string, { label: string; pool: Pool; byMonth: Map<string, number> }>();
  const phases = new Map<string, { group: string; label: string; month: string; items: { month: string; amount: number; pool: Pool }[] }>();
  const fixed = new Map<string, { label: string; items: { month: string; amount: number; pool: Pool }[] }>();
  for (const t of open ?? []) {
    const month = String(t.due_date ?? t.tx_date).slice(0, 7);
    const amount = Number(t.gross_amount);
    const label = t.description ?? t.counterparty_name ?? "Κίνηση";
    const account = Array.isArray(t.accounts) ? t.accounts[0] : t.accounts;
    const project = Array.isArray(t.projects) ? t.projects[0] : t.projects;
    const plan = Array.isArray(t.plan) ? t.plan[0] : t.plan;
    const pool = poolOf(account?.kind);
    const seriesName = (plan?.notes ?? "").match(/^\[ΠΡΟΒΛΕΨΗ\]\s*([^.]+)/)?.[1]?.trim();
    if (t.direction === "expense" && project?.code === CONTRACT.project && CONTRACT.row.test(label)) {
      const key = `${CONTRACT.group}|${t.id}`;
      phases.set(key, { group: CONTRACT.group, label, month, items: [{ month, amount, pool }] });
      continue;
    }
    const renovation = project?.code ? RENOVATIONS[project.code] : undefined;
    if (t.direction === "expense" && renovation && RENOVATION_ROW.test(label)) {
      const rest = label.replace(RENOVATION_ROW, "").replace(/^\s*—\s*/, "");
      const phase = rest ? rest[0].toUpperCase() + rest.slice(1) : label;
      const key = `${renovation}|${phase}|${month}`;
      const p = phases.get(key) ?? { group: renovation, label: phase, month, items: [] };
      p.items.push({ month, amount, pool });
      phases.set(key, p);
      continue;
    }
    if (t.direction === "expense" && seriesName) {
      const key = `${seriesName}|${pool}`;
      const s = series.get(key) ?? { label: seriesName, pool, byMonth: new Map<string, number>() };
      s.byMonth.set(month, (s.byMonth.get(month) ?? 0) + amount);
      series.set(key, s);
      continue;
    }
    // Every other instalment plan (rents, tax settlements, accountant): one
    // monthly switch per plan, on by default.
    if (t.direction === "expense" && plan?.id) {
      const f = fixed.get(plan.id) ?? { label: plan.label ?? label, items: [] as { month: string; amount: number; pool: Pool }[] };
      f.items.push({ month, amount, pool });
      fixed.set(plan.id, f);
      continue;
    }
    // Construction of a project that the bank loan finances happens only with
    // the loan: it moves with the loan switch instead of counting as certain.
    // Rows tagged "[ΜΕ ΔΑΝΕΙΟ]" are paid out of the loan too (e.g. the rest of the architects' fee).
    if (t.direction === "expense" && ((LOAN_FUNDED.test(label) && project?.code && LOAN_PROJECTS.includes(project.code)) || (t.notes ?? "").startsWith("[ΜΕ ΔΑΝΕΙΟ]"))) {
      loanFunded.push({ id: t.id, month, amount, pool });
    // Rows tagged "[ΠΡΟΒΛΕΨΗ]" are estimates, not obligations: a switch, off by default.
    } else if (t.direction === "expense" && (t.notes ?? "").startsWith("[ΠΡΟΒΛΕΨΗ]")) {
      levers.push({ kind: "forecast", id: `fc:${t.id}`, label, amount, month, pool });
    } else if (t.direction === "income" && amount >= BIG_RECEIPT) {
      const certain = t.collection_probability == null || Number(t.collection_probability) >= 1;
      levers.push({ kind: "inflow", id: `tx:${t.id}`, label, amount, month, certain, debt: false, pool });
    } else {
      flows.push({
        id: t.id, month, amount, label, pool,
        direction: t.direction === "income" ? "in" : "out",
        probability: t.collection_probability == null ? 1 : Number(t.collection_probability),
      });
    }
  }
  for (const [key, s] of series) {
    const items = [...s.byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
    levers.push({ kind: "forecast", id: `series:${key}`, label: s.label, amount: items[0].amount, month: items[0].month, pool: s.pool, items });
  }
  for (const [key, p] of [...phases].sort(([, a], [, b]) => a.month.localeCompare(b.month))) {
    const amount = p.items.reduce((s, i) => s + i.amount, 0);
    const pool = p.items.every((i) => i.pool === "cash") ? "cash" : "bank";
    levers.push({ kind: "forecast", id: `phase:${key}`, label: p.label, amount, month: p.month, pool, items: p.items, group: p.group, defaultOn: true });
  }
  for (const [id, f] of [...fixed].sort(([, a], [, b]) => b.items[0].amount - a.items[0].amount)) {
    const items = f.items.sort((a, b) => a.month.localeCompare(b.month));
    levers.push({ kind: "forecast", id: `plan:${id}`, label: f.label, amount: items[0].amount, month: items[0].month, pool: items[0].pool, items, group: "Ενοίκια & ρυθμίσεις", defaultOn: true });
  }
  for (const e of expected ?? []) {
    levers.push({
      kind: "inflow", id: `exp:${e.id}`, label: e.source, amount: Number(e.amount),
      month: String(e.expected_month ?? start).slice(0, 7), certain: e.certainty === "certain", debt: !!e.creates_liability,
      // Private money arrives in cash unless the note says otherwise (workbook: «Σε μετρητά»).
      pool: /τράπεζ|έμβασμα|optima/i.test(e.notes ?? "") ? "bank" : "cash",
    });
  }
  (loans ?? []).filter((l) => l.state !== "repaid").forEach((l, i) => {
    levers.push({
      kind: "loan", id: "bank-loan", label: "Τραπεζικό δάνειο",
      annualRate: Number(l.interest_rate),
      drawdowns: (l.loan_drawdowns ?? []).filter((d) => !d.actual_date).map((d) => ({ month: String(d.scheduled_month).slice(0, 7), amount: Number(d.amount) })),
      costs: i === 0 ? loanFunded : [], // the funded works once, not per tranche
    });
  });

  // The construction period: from the first drawdown or funded work to the
  // project's opening month.
  const firstMonths = [
    ...levers.flatMap((l) => (l.kind === "loan" ? l.drawdowns.map((d) => d.month) : [])),
    ...loanFunded.map((c) => c.month),
  ].sort();
  const construction =
    firstMonths.length && loanProject?.opening_date
      ? { label: loanProject.display_name, from: firstMonths[0], to: String(loanProject.opening_date).slice(0, 7) }
      : null;

  const delayable = flows
    .filter((f) => f.direction === "out" && f.amount >= BIG_PAYMENT && f.month >= start)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Σενάρια</h1>
        <p className="text-sm text-ink-muted">Οι επόμενοι 12 μήνες. Αλλάξτε τις επιλογές στο τέλος της σελίδας — όλα ενημερώνονται αμέσως.</p>
      </div>
      <ScenarioPanel start={start} opening={opening} buffer={buffer} personal={PERSONAL} daily={dailyStats} flows={flows} levers={levers} delayable={delayable} construction={construction} />
    </div>
  );
}
