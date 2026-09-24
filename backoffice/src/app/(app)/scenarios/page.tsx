import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/supabase/org";
import type { Flow, Lever } from "@/lib/finance/scenarios";
import { ScenarioPanel } from "./ScenarioPanel";

// Σενάρια -- 12 months of liquidity under switches the user flips. The page
// only gathers inputs; ScenarioPanel recomputes on every change in the browser.
//
// Inputs: today's liquid balance; every open (pending/scheduled) ledger row as
// a dated flow; expected income and large expected receipts as switchable
// inflows; the bank loans (in application) as one switchable financing line.

const BIG_RECEIPT = 50000; // receipts at least this large get their own switch
const BIG_PAYMENT = 20000; // payments at least this large can be delayed

export default async function ScenariosPage() {
  const supabase = await createClient();
  const [org, { data: balances }, { data: open }, { data: expected }, { data: loans }] = await Promise.all([
    getCurrentOrg(supabase),
    supabase.from("v_account_balances").select("current_balance, is_liquid"),
    supabase
      .from("transactions")
      .select("id, tx_date, due_date, direction, gross_amount, collection_probability, description, counterparty_name")
      .in("status", ["pending", "scheduled"])
      .limit(5000),
    supabase.from("expected_income").select("id, source, amount, certainty, expected_month, creates_liability"),
    supabase.from("loans").select("id, label, interest_rate, state, loan_drawdowns(scheduled_month, amount, actual_date)"),
  ]);

  const start = new Date().toISOString().slice(0, 7);
  const opening = (balances ?? []).filter((b) => b.is_liquid).reduce((s, b) => s + Number(b.current_balance ?? 0), 0);
  const buffer = Number((org.settings as Record<string, unknown>)?.min_cash_buffer ?? 50000);

  const flows: Flow[] = [];
  const levers: Lever[] = [];
  for (const t of open ?? []) {
    const month = String(t.due_date ?? t.tx_date).slice(0, 7);
    const amount = Number(t.gross_amount);
    const label = t.description ?? t.counterparty_name ?? "Κίνηση";
    if (t.direction === "income" && amount >= BIG_RECEIPT) {
      const certain = t.collection_probability == null || Number(t.collection_probability) >= 1;
      levers.push({ kind: "inflow", id: `tx:${t.id}`, label, amount, month, certain, debt: false });
    } else {
      flows.push({
        id: t.id, month, amount, label,
        direction: t.direction === "income" ? "in" : "out",
        probability: t.collection_probability == null ? 1 : Number(t.collection_probability),
      });
    }
  }
  for (const e of expected ?? []) {
    levers.push({
      kind: "inflow", id: `exp:${e.id}`, label: e.source, amount: Number(e.amount),
      month: String(e.expected_month ?? start).slice(0, 7), certain: e.certainty === "certain", debt: !!e.creates_liability,
    });
  }
  for (const l of loans ?? []) {
    if (l.state === "repaid") continue;
    levers.push({
      kind: "loan", id: "bank-loan", label: "Τραπεζικό δάνειο",
      annualRate: Number(l.interest_rate),
      drawdowns: (l.loan_drawdowns ?? []).filter((d) => !d.actual_date).map((d) => ({ month: String(d.scheduled_month).slice(0, 7), amount: Number(d.amount) })),
    });
  }

  const delayable = flows
    .filter((f) => f.direction === "out" && f.amount >= BIG_PAYMENT && f.month >= start)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Σενάρια</h1>
        <p className="text-sm text-ink-muted">Τι γίνεται με τα χρήματα τους επόμενους 12 μήνες. Αλλάξτε τις επιλογές, το αποτέλεσμα αλλάζει αμέσως.</p>
      </div>
      <ScenarioPanel start={start} opening={opening} buffer={buffer} flows={flows} levers={levers} delayable={delayable} />
    </div>
  );
}
