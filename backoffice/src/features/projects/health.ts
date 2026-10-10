// The portfolio's «τελεία υγείας»: deterministic, from SQL facts, no AI.
//   negative  over budget, an urgent open note, or an overdue payment
//   warning   no budget yet, or a note to watch
//   positive  otherwise
export type Health = "positive" | "warning" | "negative";

export function projectHealth(f: {
  hasBudget: boolean;
  remaining: number;
  urgentNotes: number;
  watchNotes: number;
  overduePayments: number;
}): Health {
  if ((f.hasBudget && f.remaining < 0) || f.urgentNotes > 0 || f.overduePayments > 0) return "negative";
  if (!f.hasBudget || f.watchNotes > 0) return "warning";
  return "positive";
}
