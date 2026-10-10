// A project's own money in and out, net of VAT and before financing -- the
// basis of «IRR έργου (χωρίς ΦΠΑ)» and of the development-and-sale result
// (margin, XIRR, peak funding need).
//
// Why not the old «IRR κεφαλαίου»: it set the capital contributions against
// income only, so every euro of capex paid with borrowed money or from
// revenue was invisible and the return came out too high. Here every flow of
// the project counts, net of VAT (VAT is the state's money passing through),
// and financing is left out on both sides (loan drawdowns, instalments,
// principal, owner's equity), so the figure is the project's own return.
//
// Flows: what is paid, on the date it cleared; what is still open (pending,
// scheduled), on its due date (overdue -> today); expected income and
// scenario costs from the cash forecast, weighted by probability; and, when
// given, the budget still not committed, as an outflow today (conservative:
// it raises the funding need rather than hiding it).
//
// Pure: no I/O, no Date.now().

import { xirr } from "./xirr";

export interface DatedFlow {
  date: string; // 'YYYY-MM-DD'
  amount: number; // + in, − out
}

// Treatments that are not the project's own economics (0020/0062).
export const NON_PROJECT_TREATMENTS = ["vat", "pass_through", "principal", "equity", "financing"] as const;

export interface TxLike {
  direction: "income" | "expense" | string;
  status: string;
  tx_date: string;
  due_date?: string | null;
  paid_on?: string | null;
  gross_amount: number | string;
  net_amount?: number | string | null;
  vat_amount?: number | string | null;
  withholding_amount?: number | string | null;
  loan_id?: string | null;
  treatment?: string | null;
}

export interface ExpectedLike {
  direction: "income" | "expense" | string;
  amount: number | string;
  expected_month: string | null;
  probability: number | string | null;
  certainty?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function netOf(tx: Pick<TxLike, "gross_amount" | "net_amount" | "vat_amount" | "withholding_amount">): number {
  if (tx.net_amount != null) return Number(tx.net_amount);
  return Number(tx.gross_amount) - Number(tx.vat_amount ?? 0) + Number(tx.withholding_amount ?? 0);
}

export function flowFromTransaction(tx: TxLike, today: string): DatedFlow | null {
  if (tx.status === "cancelled" || tx.loan_id) return null;
  if (tx.treatment && (NON_PROJECT_TREATMENTS as readonly string[]).includes(tx.treatment)) return null;
  const amount = netOf(tx);
  if (!amount) return null;
  const date =
    tx.status === "paid"
      ? (tx.paid_on ?? tx.tx_date)
      : [tx.due_date ?? tx.tx_date, today].sort()[1]; // overdue -> today
  return { date, amount: round2(tx.direction === "income" ? amount : -amount) };
}

export function flowFromExpected(e: ExpectedLike, today: string): DatedFlow | null {
  if (!e.expected_month) return null;
  const p = e.probability != null ? Number(e.probability) : e.certainty === "certain" ? 1 : 0.5;
  const amount = round2(Number(e.amount) * p);
  if (!amount) return null;
  const date = [e.expected_month, today].sort()[1];
  return { date, amount: e.direction === "expense" ? -amount : amount };
}

export interface DevelopmentResult {
  revenue: number; // inflows
  cost: number; // outflows, positive
  margin: number; // revenue − cost
  marginPct: number | null; // margin ÷ revenue
  irr: number | null; // XIRR of the flows; null without both signs
  peakFunding: number; // the deepest the cumulative flow goes below zero, positive
  peakFundingDate: string | null;
  flowCount: number;
}

export function computeDevelopmentResult(
  flows: DatedFlow[],
  opts: { today: string; remainingBudget?: number | null },
): DevelopmentResult {
  const all = [...flows];
  const remaining = Number(opts.remainingBudget ?? 0);
  if (remaining > 0) all.push({ date: opts.today, amount: -round2(remaining) });
  all.sort((a, b) => a.date.localeCompare(b.date));

  let revenue = 0;
  let cost = 0;
  let running = 0;
  let low = 0;
  let lowDate: string | null = null;
  for (const f of all) {
    if (f.amount > 0) revenue += f.amount;
    else cost -= f.amount;
    running += f.amount;
    if (running < low - 1e-9) {
      low = running;
      lowDate = f.date;
    }
  }
  revenue = round2(revenue);
  cost = round2(cost);
  const margin = round2(revenue - cost);
  return {
    revenue,
    cost,
    margin,
    marginPct: revenue > 0 ? margin / revenue : null,
    irr: xirr(all),
    peakFunding: round2(-low),
    peakFundingDate: lowDate,
    flowCount: all.length,
  };
}
