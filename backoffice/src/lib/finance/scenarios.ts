// Cash scenarios: month-by-month liquidity for the next N months under a set
// of switches ("what if Albert's 70.000 doesn't come", "what if the loan is
// drawn", "what if phase A slips 3 months"). Pure: the page loads the inputs,
// this computes; nothing is stored.
//
// Month keys are 'YYYY-MM'. Anything open and already overdue lands in the
// first month -- it still has to be paid.

export type Flow = {
  id: string;
  month: string; // YYYY-MM it is due
  amount: number; // positive
  direction: "in" | "out";
  label: string;
  probability?: number; // inflows only; 1 = certain
};

export type Lever =
  | { kind: "inflow"; id: string; label: string; amount: number; month: string; certain: boolean; debt: boolean }
  | { kind: "loan"; id: string; label: string; drawdowns: { month: string; amount: number }[]; annualRate: number };

export type Choices = {
  on: Record<string, boolean>; // lever id -> included
  inflowMonth: Record<string, string>; // lever id -> chosen month
  delay: Record<string, number>; // flow id -> months later
  personalMonthly: number;
  weightInflows: boolean; // multiply uncertain inflows by their probability
};

export type MonthRow = {
  month: string;
  opening: number;
  inflow: number;
  outflow: number;
  financing: number; // loan drawdowns and private loans (not income)
  interest: number;
  personal: number;
  closing: number;
};

export type ScenarioResult = {
  rows: MonthRow[];
  lowest: { month: string; closing: number };
  firstBelowBuffer: string | null;
  firstNegative: string | null;
  endBalance: number;
  totalIn: number;
  totalOut: number;
  newDebt: number;
  coverageMonths: number; // how many months today's cash covers, at the plan's average outflow
};

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthsFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(start, i));
}

export function computeScenario(input: {
  start: string;
  months: number;
  opening: number;
  buffer: number;
  flows: Flow[];
  levers: Lever[];
  choices: Choices;
}): ScenarioResult {
  const { start, months, opening, buffer, flows, levers, choices } = input;
  const keys = monthsFrom(start, months);
  const last = keys[keys.length - 1];
  const bucket = (m: string) => (m < start ? start : m);
  const rows = new Map<string, MonthRow>(
    keys.map((k) => [k, { month: k, opening: 0, inflow: 0, outflow: 0, financing: 0, interest: 0, personal: choices.personalMonthly, closing: 0 }]),
  );

  for (const f of flows) {
    const m = bucket(addMonths(f.month, choices.delay[f.id] ?? 0));
    const row = rows.get(m);
    if (!row || m > last) continue;
    if (f.direction === "out") row.outflow += f.amount;
    else row.inflow += f.amount * (choices.weightInflows ? f.probability ?? 1 : 1);
  }

  let newDebt = 0;
  for (const l of levers) {
    if (!choices.on[l.id]) continue;
    if (l.kind === "inflow") {
      const m = bucket(choices.inflowMonth[l.id] ?? l.month);
      const row = rows.get(m);
      if (!row) continue;
      if (l.debt) {
        row.financing += l.amount;
        newDebt += l.amount;
      } else row.inflow += l.amount;
    } else {
      // Grace period: interest only, on the balance drawn so far.
      let drawn = 0;
      for (const k of keys) {
        const d = l.drawdowns.filter((x) => x.month === k).reduce((s, x) => s + x.amount, 0);
        const row = rows.get(k)!;
        row.interest += drawn * (l.annualRate / 12);
        drawn += d;
        row.financing += d;
      }
      newDebt += drawn;
    }
  }

  let balance = opening;
  for (const k of keys) {
    const r = rows.get(k)!;
    r.opening = balance;
    r.closing = balance + r.inflow + r.financing - r.outflow - r.interest - r.personal;
    balance = r.closing;
  }

  const list = [...rows.values()];
  const lowest = list.reduce((a, b) => (b.closing < a.closing ? b : a), list[0]);
  const totalOut = list.reduce((s, r) => s + r.outflow + r.interest + r.personal, 0);
  const avgOut = totalOut / list.length;
  return {
    rows: list,
    lowest: { month: lowest.month, closing: lowest.closing },
    firstBelowBuffer: list.find((r) => r.closing < buffer)?.month ?? null,
    firstNegative: list.find((r) => r.closing < 0)?.month ?? null,
    endBalance: balance,
    totalIn: list.reduce((s, r) => s + r.inflow + r.financing, 0),
    totalOut,
    newDebt,
    coverageMonths: avgOut > 0 ? opening / avgOut : Infinity,
  };
}
