import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { monthCells } from "@/lib/planner/calendar";
import { monthKeyOf } from "@/lib/dates";

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
// position on a month than as a sorted list of dates. The grid itself is
// monthCells() (src/lib/planner/calendar.ts), shared with /planner's
// calendar; days outside the month render blank here.
export function DueDatesCalendar({ dueDates, todayIso }: { dueDates: DueTx[]; todayIso: string }) {
  const today = new Date(todayIso + "T00:00:00Z");
  const cells = monthCells(monthKeyOf(todayIso));

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

  const monthLabel = today.toLocaleDateString("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-2 text-sm text-ink capitalize">{monthLabel}</div>
      <div className="grid grid-cols-7 border-t border-l border-hairline text-center text-xs">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="eyebrow border-r border-b border-hairline border-b-rule py-2 text-muted">
            {w}
          </div>
        ))}
        {cells.map(({ day, dateIso, inMonth }) => {
          if (!inMonth) return <div key={dateIso} className="border-r border-b border-hairline" />;
          const entry = byDay.get(dateIso);
          const isToday = dateIso === todayIso;
          const content = (
            <div
              className={`flex h-14 min-w-0 flex-col items-center justify-start gap-0.5 overflow-hidden border-l-2 p-1 text-xs ${
                entry?.hasOverdueUnpaid ? "border-l-negative" : entry ? "border-l-warning" : "border-l-transparent"
              } ${isToday ? "bg-hover" : ""}`}
            >
              <span className={`num ${isToday ? "font-medium text-navy" : "text-muted"}`}>{day}</span>
              {entry && (
                <span className="num max-w-full truncate text-[10px] text-ink">
                  {entry.total < 0 ? "−" : "+"}
                  {formatMoney(Math.abs(entry.total))}
                </span>
              )}
            </div>
          );
          return entry ? (
            <Link key={dateIso} href={`/transactions?ids=${entry.ids.join(",")}`} className="border-r border-b border-hairline hover:bg-hover">
              {content}
            </Link>
          ) : (
            <div key={dateIso} className="border-r border-b border-hairline">
              {content}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-negative" /> εκπρόθεσμο
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-warning" /> προσεχές
        </span>
      </div>
    </div>
  );
}
