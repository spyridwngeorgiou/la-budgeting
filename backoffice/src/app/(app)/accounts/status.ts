import type { Database } from "@/lib/db/types";
import type { BalanceCheck } from "./BalanceAssertion";

// Plain helpers (no "use client") so the server pages and the client
// breakdown share one rule for «συμφωνεί».
export const okGap = (gap: number) => Math.abs(gap) < 1;

export type AccountStatus = "drift" | "never_counted" | "ok";

// The latest check (newest first) decides: none yet, a gap, or agreement.
export function statusOf(checks: BalanceCheck[] | undefined): { status: AccountStatus; latest: BalanceCheck | null } {
  const latest = checks?.[0] ?? null;
  if (!latest) return { status: "never_counted", latest: null };
  return { status: okGap(latest.total_gap) ? "ok" : "drift", latest };
}

export const STATUS_LABEL: Record<AccountStatus, string> = {
  ok: "συμφωνεί",
  drift: "απόκλιση",
  never_counted: "χωρίς έλεγχο",
};

export const STATUS_TONE = { ok: "positive", drift: "negative", never_counted: "warning" } as const;

// A check older than this shows its date in the warning colour.
const STALE_DAYS = 35;
export function isStale(asOfDate: string, today: string): boolean {
  return (Date.parse(today) - Date.parse(asOfDate)) / 86_400_000 > STALE_DAYS;
}

type CheckRow = Database["public"]["Views"]["v_balance_checks"]["Row"];

// One v_balance_checks row (0035) as the BalanceCheck the UI reads.
export function toBalanceCheck(r: CheckRow): BalanceCheck {
  return {
    id: r.id!,
    as_of_date: r.as_of_date!,
    asserted_balance: Number(r.asserted_balance),
    from_import: Boolean(r.from_import),
    period_start: r.period_start!,
    period_start_balance: Number(r.period_start_balance),
    period_start_source: r.period_start_source as BalanceCheck["period_start_source"],
    period_income: Number(r.period_income),
    period_income_n: Number(r.period_income_n),
    period_expense: Number(r.period_expense),
    period_expense_n: Number(r.period_expense_n),
    expected_balance: Number(r.expected_balance),
    period_gap: Number(r.period_gap),
    total_gap: Number(r.total_gap),
  };
}
