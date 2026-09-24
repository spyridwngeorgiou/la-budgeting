// XIRR: the annualised return implied by a set of dated, irregularly-spaced
// cash flows -- exactly what a real investment produces (capital calls and
// distributions never land on a tidy annual schedule). This is the general
// tool; it is deliberately NOT wired into the 23-year DSCR/NPV model in
// projectCashflow.ts, which answers a different, narrower question (can debt
// service be covered, discounted at a chosen rate) for the subset of
// projects that have a lease+loan+revenue-plan set up. XIRR here answers
// "what return has this actual money, in and out, produced so far" for any
// project, from nothing more than dated amounts.
export interface CashFlow {
  date: string; // 'YYYY-MM-DD'
  amount: number; // negative = money out (contribution), positive = money in (return)
}

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

function npv(rate: number, flows: CashFlow[], t0: string): number {
  return flows.reduce((sum, f) => sum + f.amount / Math.pow(1 + rate, daysBetween(t0, f.date) / 365), 0);
}

function npvDerivative(rate: number, flows: CashFlow[], t0: string): number {
  return flows.reduce((sum, f) => {
    const years = daysBetween(t0, f.date) / 365;
    if (years === 0) return sum;
    return sum - (years * f.amount) / Math.pow(1 + rate, years + 1);
  }, 0);
}

// Newton-Raphson, falling back to bisection over a wide bracket if it
// doesn't converge -- real contribution/return sequences (a big draw, small
// trickle of income, one late payout) are exactly the shape that can make
// Newton's method overshoot or diverge from a bad starting guess.
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const hasPositive = flows.some((f) => f.amount > 0);
  const hasNegative = flows.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = sorted[0].date;

  let rate = 0.1;
  for (let i = 0; i < 50; i++) {
    const value = npv(rate, sorted, t0);
    const derivative = npvDerivative(rate, sorted, t0);
    if (Math.abs(derivative) < 1e-10) break;
    const next = rate - value / derivative;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next;
    if (rate <= -0.999) rate = -0.999 + 1e-6; // stay inside the domain (1+rate > 0)
  }

  // Newton didn't settle -- bisection over a bracket wide enough for
  // anything realistic (-99% to +1000% annualised).
  let low = -0.999;
  let high = 10;
  let lowValue = npv(low, sorted, t0);
  const highValue = npv(high, sorted, t0);
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const midValue = npv(mid, sorted, t0);
    if (Math.abs(midValue) < 1e-6) return mid;
    if (Math.sign(midValue) === Math.sign(lowValue)) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}
