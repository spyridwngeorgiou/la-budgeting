import Link from "next/link";
import { ButtonLink, EmptyState, cn } from "@/components/ui";
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
        <h2 className="text-section font-normal text-ink capitalize">{monthLabel(monthKey)}</h2>
        <div className="flex">
          <ButtonLink href={nav.prev} size="sm" className="max-md:min-h-11">
            {el.planner.calendar.prev}
          </ButtonLink>
          <ButtonLink href={nav.today} size="sm" className="-ml-px max-md:min-h-11">
            {el.planner.calendar.thisMonth}
          </ButtonLink>
          <ButtonLink href={nav.next} size="sm" className="-ml-px max-md:min-h-11">
            {el.planner.calendar.next}
          </ButtonLink>
        </div>
      </div>

      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-t border-l border-hairline text-xs">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="eyebrow border-r border-b border-hairline border-b-rule bg-raised px-1.5 py-2 text-muted">
              {w}
            </div>
          ))}
          {monthCells(monthKey).map((cell) => {
            const dayItems = byDay.get(cell.dateIso) ?? [];
            const isToday = cell.dateIso === today;
            return (
              <div
                key={cell.dateIso}
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "flex min-h-24 flex-col gap-0.5 border-r border-b border-hairline p-1",
                  cell.inMonth ? "bg-field" : "bg-raised",
                  isToday && "outline outline-1 -outline-offset-1 outline-navy",
                )}
              >
                <span
                  className={cn(
                    "num self-end px-1 text-xs",
                    isToday ? "bg-navy font-medium text-panel-ink" : cell.inMonth ? "text-text" : "text-muted",
                  )}
                >
                  {cell.day}
                </span>
                {dayItems.slice(0, MAX_PER_CELL).map((item) => (
                  <Pill key={item.item_key} item={item} href={hrefFor(item)} overdue={!item.is_done && item.ends_on < today} />
                ))}
                {dayItems.length > MAX_PER_CELL && (
                  <span className="px-1 text-xs text-muted">
                    +{dayItems.length - MAX_PER_CELL} {el.planner.calendar.more}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col md:hidden">
        {agenda.length === 0 && <EmptyState title={el.planner.calendar.empty} />}
        {agenda.map((day) => (
          <section key={day.dateIso} className="border-b border-hairline py-3">
            <h3 className={cn("eyebrow mb-2", day.dateIso === today ? "text-navy" : "text-muted")}>
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
      className={cn(
        "flex items-center gap-1 border-l-2 bg-field leading-tight group-hover:bg-hover",
        wide ? "min-h-11 px-2 py-1.5 text-sm" : "px-1 py-0.5 text-xs",
        SOURCE_PILL[item.source],
        item.is_done && "text-muted line-through",
        overdue && "border-negative text-negative",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {item.amount != null && (
        <span className="num shrink-0">
          {item.direction === "income" ? "+" : item.direction === "expense" ? "−" : ""}
          {formatMoney(item.amount)}
        </span>
      )}
    </span>
  );
  return href ? (
    <Link href={href} className="group block">
      {body}
    </Link>
  ) : (
    body
  );
}
