// «Ρευστά τελευταίων 12 μηνών»: the ACTUAL month-end balance of the liquid
// accounts, rebuilt backwards from today's balance (v_account_balances) and
// the paid movements per month (v_account_ledger_monthly, 0091) -- the same
// rule the balance itself uses, so the last point is today's «Ρευστά».
// No net-worth history exists, so none is drawn. Pure; tested.

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LiquidAccount {
  account_id: string | null;
  current_balance: number | string | null;
  opening_balance_date: string | null; // 'YYYY-MM-DD'
}

export interface LedgerMonth {
  account_id: string | null;
  month: string | null; // 'YYYY-MM'
  inflow: number | string | null;
  outflow: number | string | null;
}

// monthKeys: ascending 'YYYY-MM', the last one the current month. The
// balance at the end of month m = today's balance − every movement paid
// after m. An account whose opening date is after the end of m is left out
// of m (it did not exist yet in the app's books).
export function liquidMonthEnds(
  monthKeys: string[],
  accounts: LiquidAccount[],
  ledger: LedgerMonth[],
): { month: string; balance: number }[] {
  const ids = new Set(accounts.map((a) => a.account_id).filter((x): x is string => !!x));
  const netOf = new Map<string, number>(); // `${account}|${month}` -> net
  for (const r of ledger) {
    if (!r.account_id || !r.month || !ids.has(r.account_id)) continue;
    const k = `${r.account_id}|${r.month}`;
    netOf.set(k, (netOf.get(k) ?? 0) + num(r.inflow) - num(r.outflow));
  }
  return monthKeys.map((m, idx) => {
    const later = monthKeys.slice(idx + 1);
    let total = 0;
    for (const a of accounts) {
      if (!a.account_id) continue;
      if (a.opening_balance_date && a.opening_balance_date.slice(0, 7) > m) continue;
      let bal = num(a.current_balance);
      for (const l of later) bal -= netOf.get(`${a.account_id}|${l}`) ?? 0;
      total += bal;
    }
    return { month: m, balance: round2(total) };
  });
}
