import Link from "next/link";
import { el } from "@/lib/i18n/el";
import { formatMoney } from "@/lib/format";
import { dayMonthLabel, firstOfMonth, lastOfMonth, monthLabel } from "@/lib/dates";
import { agendaDays, groupByDay, monthCells, monthGridRange, type CalendarItem } from "@/lib/planner/calendar";
import { SOURCE_PILL, calendarItemLabel } from "./labels";

const WEEKDAY_LABELS = ["Δε", "Τρ", "Τε", "Πε", "Πα", "Σα", "Κυ"];
const MAX_PER_CELL = 3;

// The unified calendar: a month grid on desktop, an agenda list on phones,
// both from the same items. Server-rendered; navigation and filters are
// plain links the page builds, and `hrefFor` decides where an item leads
// (the partner space links only to tasks).
export function PlannerCalendar({
  items,
  monthKey,
  today,
  nav,
  hrefFor,
}: {
  items: CalendarItem[];
  monthKey: string;
  today: string;
  nav: { prev: string; next: string; today: string };
  hrefFor: (item: CalendarItem) => string | null;
}) {
  const range = monthGridRange(monthKey);
  const byDay = groupByDay(items, range);
  // The agenda sticks to the month itself; the grid's spill-over days from
  // neighbouring months would only repeat on the next/previous page.
  const agenda = agendaDays(items, { start: firstOfMonth(monthKey), end: lastOfMonth(monthKey) });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium text-ink capitalize">{monthLabel(monthKey)}</h2>
        <div className="flex gap-1 text-sm">
          <Link href={nav.prev} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-bg">
            {el.planner.calendar.prev}
          </Link>
          <Link href={nav.today} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-bg">
            {el.planner.calendar.thisMonth}
          </Link>
          <Link href={nav.next} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-bg">
            {el.planner.calendar.next}
          </Link>
        </div>
      </div>

      <div className="hidden rounded-lg border border-line bg-surface p-2 md:block">
        <div className="grid grid-cols-7 gap-1 text-xs">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="py-1 text-center text-ink-faint">
              {w}
            </div>
          ))}
          {monthCells(monthKey).map((cell) => {
            const dayItems = byDay.get(cell.dateIso) ?? [];
            const isToday = cell.dateIso === today;
            return (
              <div
                key={cell.dateIso}
                className={`flex min-h-24 flex-col gap-0.5 rounded border p-1 ${
                  isToday ? "border-sage-strong bg-sage/30" : "border-line"
                } ${cell.inMonth ? "" : "bg-bg/60"}`}
              >
                <span
                  className={`text-right text-[11px] ${
                    isToday ? "font-semibold text-sage-ink" : cell.inMonth ? "text-ink-muted" : "text-ink-faint"
                  }`}
                >
                  {cell.day}
                </span>
                {dayItems.slice(0, MAX_PER_CELL).map((item) => (
                  <Pill key={item.item_key} item={item} href={hrefFor(item)} overdue={!item.is_done && item.ends_on < today} />
                ))}
                {dayItems.length > MAX_PER_CELL && (
                  <span className="px-1 text-[10px] text-ink-faint">
                    +{dayItems.length - MAX_PER_CELL} {el.planner.calendar.more}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 md:hidden">
        {agenda.length === 0 && (
          <p className="rounded-lg border border-line bg-surface p-4 text-center text-sm text-ink-faint">
            {el.planner.calendar.empty}
          </p>
        )}
        {agenda.map((day) => (
          <section key={day.dateIso} className="rounded-lg border border-line bg-surface p-2">
            <h3 className={`mb-1 text-xs font-medium ${day.dateIso === today ? "text-sage-ink" : "text-ink-muted"}`}>
              {dayMonthLabel(day.dateIso)}
            </h3>
            <ul className="flex flex-col gap-1">
              {day.items.map((item) => (
                <li key={item.item_key}>
                  <Pill item={item} href={hrefFor(item)} overdue={!item.is_done && item.ends_on < today} wide />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Pill({
  item,
  href,
  overdue,
  wide,
}: {
  item: CalendarItem;
  href: string | null;
  overdue: boolean;
  wide?: boolean;
}) {
  const label = calendarItemLabel(item);
  const body = (
    <span
      title={`${el.planner.source[item.source]} · ${label}`}
      className={`flex items-center gap-1 rounded border px-1 py-0.5 ${wide ? "text-sm" : "text-[11px]"} leading-tight ${
        SOURCE_PILL[item.source]
      } ${item.is_done ? "opacity-50 line-through" : ""} ${overdue ? "ring-1 ring-red-ink/50" : ""}`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {item.amount != null && (
        <span className="shrink-0 font-mono tabular-nums">
          {item.direction === "income" ? "+" : item.direction === "expense" ? "−" : ""}
          {formatMoney(item.amount)}
        </span>
      )}
    </span>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}
