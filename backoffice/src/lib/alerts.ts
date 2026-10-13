// What needs attention, shared by the «Ειδοποιήσεις» page and the red count in
// the menu: open payments that are overdue or due within 7 days. Dates are
// compared as YYYY-MM-DD strings (Athens day is close enough for a reminder).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function alertWindow(now = new Date()) {
  const today = isoDay(now);
  const week = isoDay(new Date(now.getTime() + 7 * 86400000));
  return { today, week };
}

// Open row is "due" on due_date, or on tx_date when it has none.
export const dueBefore = (day: string) => `due_date.lt.${day},and(due_date.is.null,tx_date.lt.${day})`;
export const dueBetween = (from: string, to: string) =>
  `and(due_date.gte.${from},due_date.lte.${to}),and(due_date.is.null,tx_date.gte.${from},tx_date.lte.${to})`;

// Forecasts (row or plan tagged [ΠΡΟΒΛΕΨΗ]) and loan-funded rows are not
// payments yet; same rule as the «Ειδοποιήσεις» page.
export const isPayment = (r: { notes: string | null; plan?: { notes: string | null } | { notes: string | null }[] | null }) => {
  const plan = Array.isArray(r.plan) ? r.plan[0] : r.plan;
  return !/^\[(ΠΡΟΒΛΕΨΗ|ΜΕ ΔΑΝΕΙΟ)\]/.test(r.notes ?? "") && !/^\[ΠΡΟΒΛΕΨΗ\]/.test(plan?.notes ?? "");
};

export async function countAlerts(supabase: SupabaseClient<Database>) {
  // Same window as the page: overdue, plus due up to and including 7 days from today.
  const dayAfterWeek = isoDay(new Date(Date.now() + 8 * 86400000));
  const { data } = await supabase
    .from("transactions")
    .select("notes, plan:installment_plans!transactions_plan_id_fkey(notes)")
    .in("status", ["pending", "scheduled"])
    .eq("direction", "expense")
    .or(dueBefore(dayAfterWeek))
    .limit(1000);
  return (data ?? []).filter(isPayment).length;
}
