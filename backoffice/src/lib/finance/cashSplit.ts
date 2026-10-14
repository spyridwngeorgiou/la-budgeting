// Banks vs cash in hand (cash_forecast_by_kind, 0097): the first month the
// notes run out. The total can stay healthy while the «Μετρητά» account goes
// below zero -- then money has to be drawn from a bank. Read by /reports/cash
// (the warning line) and the dashboard («Χρειάζεται Προσοχή»).

export interface KindRow {
  month: string; // 'YYYY-MM-DD'
  cash_closing: number | string | null;
}

// The first month whose cash closes below zero, with the shortfall then;
// null when cash never runs out in the horizon read.
export function cashRunsOut(rows: KindRow[]): { month: string; closing: number } | null {
  const hit = rows.find((r) => Number(r.cash_closing ?? 0) < 0);
  return hit ? { month: hit.month.slice(0, 7), closing: Number(hit.cash_closing) } : null;
}

// Whether the split is worth showing: some cash in hand now or later.
export function hasCash(rows: KindRow[]): boolean {
  return rows.some((r) => Number(r.cash_closing ?? 0) !== 0);
}
