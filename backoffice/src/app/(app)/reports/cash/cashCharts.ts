// Chart rows for Ταμείο & Πρόβλεψη. The SQL (cash_forecast /
// cash_forecast_items, 0066/0090) decides every figure; these only reshape
// rows the page already read. Pure, so the shapes are tested.

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ── The closing balance per scenario, one datum per month ───────────────────
export interface BalanceRow {
  month: string; // 'YYYY-MM-DD'
  closing_balance: number | string | null;
}

// rowsByKey: { base: rows, optimistic: rows, … } (all the same months).
// The first key's months set the x axis.
export function scenarioBalanceRows(
  rowsByKey: Record<string, BalanceRow[]>,
  label: (monthKey: string) => string,
): Record<string, string | number | null>[] {
  const keys = Object.keys(rowsByKey);
  const axis = keys.length ? rowsByKey[keys[0]] : [];
  return axis.map((r) => {
    const m = r.month.slice(0, 7);
    const datum: Record<string, string | number | null> = { label: label(m) };
    for (const k of keys) {
      const hit = rowsByKey[k].find((x) => x.month.slice(0, 7) === m);
      datum[k] = hit ? round2(num(hit.closing_balance)) : null;
    }
    return datum;
  });
}
