import Link from "next/link";
import { formatMoney } from "@/lib/format";

interface DueTx {
  id: string;
  due_date: string | null;
  direction: string;
  gross_amount: number | null;
}

const WEEKDAY_LABELS = ["Δε", "Τρ", "Τε", "Πε", "Πα", "Σα", "Κυ"];

// Monday-first grid for the current month, padded with blank leading/
// trailing cells so weekdays line up -- the calendar shape the user asked
// for in place of a flat list, since "when is this due" reads faster as a
// position on a month than as a sorted list of dates.
export function DueDatesCalendar({ dueDates, todayIso }: { dueDates: DueTx[]; todayIso: string }) {
  const today = new Date(todayIso + "T00:00:00Z");
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // JS getUTCDay(): Sunday=0..Saturday=6 -- shift so Monday=0.
  const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;

  const byDay = new Map<string, { total: number; ids: string[]; hasOverdueUnpaid: boolean }>();
  for (const tx of dueDates) {
    if (!tx.due_date) continue; // query already filters this out server-side; guard is just for the type
    const key = tx.due_date;
    const entry = byDay.get(key) ?? { total: 0, ids: [], hasOverdueUnpaid: false };
    const signed = tx.direction === "income" ? Number(tx.gross_amount ?? 0) : -Number(tx.gross_amount ?? 0);
    entry.total += signed;
    entry.ids.push(tx.id);
    if (key < todayIso) entry.hasOverdueUnpaid = true;
    byDay.set(key, entry);
  }

  const cells: { day: number; dateIso: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateIso: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
  }

  const monthLabel = today.toLocaleDateString("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 text-sm font-medium text-ink capitalize">{monthLabel}</div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-1 text-ink-faint">
            {w}
          </div>
        ))}
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {cells.map(({ day, dateIso }) => {
          const entry = byDay.get(dateIso);
          const isToday = dateIso === todayIso;
          const content = (
            <div
              className={`flex h-14 flex-col items-center justify-start gap-0.5 rounded border p-1 text-xs ${
                isToday
                  ? "border-sage-strong bg-sage/40"
                  : entry?.hasOverdueUnpaid
                    ? "border-red-ink/40 bg-red-bg"
                    : entry
                      ? "border-amber-ink/40 bg-amber-bg"
                      : "border-line"
              }`}
            >
              <span className={isToday ? "font-semibold text-sage-ink" : "text-ink-muted"}>{day}</span>
              {entry && (
                <span className={`font-mono text-[10px] ${entry.total < 0 ? "text-red-ink" : "text-sage-ink"}`}>
                  {entry.total < 0 ? "-" : "+"}
                  {formatMoney(Math.abs(entry.total))}
                </span>
              )}
            </div>
          );
          return entry ? (
            <Link key={dateIso} href={`/transactions?ids=${entry.ids.join(",")}`} className="hover:opacity-80">
              {content}
            </Link>
          ) : (
            <div key={dateIso}>{content}</div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-red-ink/40 bg-red-bg" /> εκπρόθεσμο
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-ink/40 bg-amber-bg" /> προσεχές
        </span>
      </div>
    </div>
  );
}
