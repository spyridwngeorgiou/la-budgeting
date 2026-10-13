// Cash scenarios: month-by-month liquidity for the next N months under a set
// of switches ("what if Albert's 70.000 doesn't come", "what if the loan is
// drawn", "what if phase A slips 3 months"). Pure: the page loads the inputs,
// this computes; nothing is stored.
//
// Money is tracked in two pools -- cash in hand and money in the banks --
// because they are not interchangeable: the bank wants its own-contribution
// in Optima, advances to professionals go out in cash. Totals are their sum.
//
// Month keys are 'YYYY-MM'. Anything open and already overdue lands in the
// first month -- it still has to be paid.

export type Pool = "cash" | "bank";

export type Flow = {
  id: string;
  month: string; // YYYY-MM it is due
  amount: number; // positive
  direction: "in" | "out";
  label: string;
  pool: Pool;
  probability?: number; // inflows only; 1 = certain
};

export type Lever =
  | { kind: "inflow"; id: string; label: string; amount: number; month: string; certain: boolean; debt: boolean; pool: Pool }
  // An estimated payment (budget-level, not signed): counted only when switched on.
  // With `items` it is a monthly series (e.g. a settlement not yet activated):
  // `amount`/`month` are then its first instalment, `items` every instalment.
  // `group` shows it under its own heading (e.g. one renovation's phases);
  // `defaultOn` counts it unless switched off (signed work, not an estimate).
  | { kind: "forecast"; id: string; label: string; amount: number; month: string; pool: Pool; items?: { month: string; amount: number; pool?: Pool }[]; group?: string; defaultOn?: boolean }
  // Bank loan: drawdowns and grace interest go through the bank pool. `costs`
  // are the works the loan pays for (e.g. construction phases): they happen
  // only if the loan does, so they are switched on and off with it.
  | { kind: "loan"; id: string; label: string; drawdowns: { month: string; amount: number }[]; annualRate: number; costs?: { id: string; month: string; amount: number; pool: Pool }[] };

export type Choices = {
  on: Record<string, boolean>; // lever id -> included
  inflowMonth: Record<string, string>; // lever id -> chosen month
  delay: Record<string, number>; // flow id -> months later
  personalCash: number; // monthly personal spending paid in cash
  personalBank: number; // monthly personal spending paid by card/bank
  weightInflows: boolean; // multiply uncertain inflows by their probability
  // Money moved from the banks to cash in hand that month (negative: cash to bank).
  // Changes the split, never the total.
  transfer?: { month: string; amount: number };
};

type Amounts = { inflow: number; outflow: number; financing: number; interest: number; personal: number; transfer: number };

export type MonthRow = Amounts & {
  month: string;
  opening: number;
  closing: number;
  cash: Amounts & { closing: number };
  bank: Amounts & { closing: number };
};

export type PoolSummary = {
  today: number;
  lowest: { month: string; closing: number };
  endBalance: number;
  firstNegative: string | null;
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
  coverageMonths: number; // how many months today's money covers, at the plan's average outflow
  cash: PoolSummary;
  bank: PoolSummary;
};

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthsFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(start, i));
}

const zero = (): Amounts => ({ inflow: 0, outflow: 0, financing: 0, interest: 0, personal: 0, transfer: 0 });

export function computeScenario(input: {
  start: string;
  months: number;
  opening: { cash: number; bank: number };
  buffer: number;
  flows: Flow[];
  levers: Lever[];
  choices: Choices;
}): ScenarioResult {
  const { start, months, opening, buffer, flows, levers, choices } = input;
  const keys = monthsFrom(start, months);
  const last = keys[keys.length - 1];
  const bucket = (m: string) => (m < start ? start : m);
  const pools = new Map<string, { cash: Amounts; bank: Amounts }>(keys.map((k) => [k, { cash: zero(), bank: zero() }]));
  for (const p of pools.values()) {
    p.cash.personal = choices.personalCash;
    p.bank.personal = choices.personalBank;
  }
  const at = (m: string, pool: Pool) => (m > last ? undefined : pools.get(bucket(m))?.[pool]);

  for (const f of flows) {
    const a = at(addMonths(f.month, choices.delay[f.id] ?? 0), f.pool);
    if (!a) continue;
    if (f.direction === "out") a.outflow += f.amount;
    else a.inflow += f.amount * (choices.weightInflows ? f.probability ?? 1 : 1);
  }

  let newDebt = 0;
  for (const l of levers) {
    if (!choices.on[l.id]) continue;
    if (l.kind === "inflow") {
      const a = at(choices.inflowMonth[l.id] ?? l.month, l.pool);
      if (!a) continue;
      if (l.debt) {
        a.financing += l.amount;
        newDebt += l.amount;
      } else a.inflow += l.amount;
    } else if (l.kind === "forecast") {
      for (const it of l.items ?? [{ month: l.month, amount: l.amount }]) {
        const a = at(addMonths(it.month, choices.delay[l.id] ?? 0), it.pool ?? l.pool);
        if (a) a.outflow += it.amount;
      }
    } else {
      // Grace period: interest only, on the balance drawn so far.
      let drawn = 0;
      for (const k of keys) {
        const d = l.drawdowns.filter((x) => x.month === k).reduce((s, x) => s + x.amount, 0);
        const a = pools.get(k)!.bank;
        a.interest += drawn * (l.annualRate / 12);
        drawn += d;
        a.financing += d;
      }
      newDebt += drawn;
      for (const c of l.costs ?? []) {
        const a = at(addMonths(c.month, choices.delay[c.id] ?? 0), c.pool);
        if (a) a.outflow += c.amount;
      }
    }
  }

  const tr = choices.transfer;
  if (tr && tr.amount && pools.has(bucket(tr.month))) {
    const p = pools.get(bucket(tr.month))!;
    p.cash.transfer += tr.amount;
    p.bank.transfer -= tr.amount;
  }
  const net = (a: Amounts) => a.inflow + a.financing - a.outflow - a.interest - a.personal + a.transfer;
  let cash = opening.cash;
  let bank = opening.bank;
  const rows: MonthRow[] = keys.map((k) => {
    const p = pools.get(k)!;
    const openingTotal = cash + bank;
    cash += net(p.cash);
    bank += net(p.bank);
    const sum = (f: keyof Amounts) => p.cash[f] + p.bank[f];
    return {
      month: k, opening: openingTotal, closing: cash + bank,
      inflow: sum("inflow"), outflow: sum("outflow"), financing: sum("financing"), interest: sum("interest"), personal: sum("personal"), transfer: 0,
      cash: { ...p.cash, closing: cash },
      bank: { ...p.bank, closing: bank },
    };
  });

  const summary = (pick: (r: MonthRow) => number, today: number): PoolSummary => {
    const low = rows.reduce((a, b) => (pick(b) < pick(a) ? b : a), rows[0]);
    return {
      today,
      lowest: { month: low.month, closing: pick(low) },
      endBalance: pick(rows[rows.length - 1]),
      firstNegative: rows.find((r) => pick(r) < 0)?.month ?? null,
    };
  };
  const total = summary((r) => r.closing, opening.cash + opening.bank);
  const totalOut = rows.reduce((s, r) => s + r.outflow + r.interest + r.personal, 0);
  const avgOut = totalOut / rows.length;
  return {
    rows,
    lowest: total.lowest,
    firstBelowBuffer: rows.find((r) => r.closing < buffer)?.month ?? null,
    firstNegative: total.firstNegative,
    endBalance: total.endBalance,
    totalIn: rows.reduce((s, r) => s + r.inflow + r.financing, 0),
    totalOut,
    newDebt,
    coverageMonths: avgOut > 0 ? (opening.cash + opening.bank) / avgOut : Infinity,
    cash: summary((r) => r.cash.closing, opening.cash),
    bank: summary((r) => r.bank.closing, opening.bank),
  };
}
