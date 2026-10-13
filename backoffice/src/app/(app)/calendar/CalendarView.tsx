import { Suspense } from "react";
import { FilterChip, Toolbar } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { addMonths, parseMonthParam } from "@/lib/dates";
import {
  CALENDAR_SOURCES,
  FINANCIAL_SOURCES,
  filterCalendarItems,
  isCalendarSource,
  monthGridRange,
  type CalendarItem,
} from "@/lib/planner/calendar";
import { loadCalendarItems } from "@/lib/planner/queries";
import { PlannerFilters } from "@/components/planner/PlannerNav";
import { PlannerCalendar } from "@/components/planner/PlannerCalendar";
import { type plannerContext, withParam } from "../planner/context";

// The month calendar, moved out of /planner (was ?view=calendar, which now
// redirects here, src/lib/redirects.ts). Same context, reads and component.

type Ctx = Awaited<ReturnType<typeof plannerContext>>;
type SearchParams = Record<string, string | string[] | undefined>;

const BASE = "/calendar";

function calendarHrefFor(item: CalendarItem): string | null {
  switch (item.source) {
    case "task":
      return item.ref_id ? `/planner/task/${item.ref_id}` : null;
    case "milestone":
      return item.project_id ? `/projects/${item.project_id}` : null;
    case "project":
      return `/projects/${item.ref_id}`;
    case "payment":
    case "installment":
      return item.ref_id ? `/transactions?ids=${item.ref_id}` : null;
    case "vat":
      return "/reports/vat";
    case "withholding":
      return "/reports/vat";
    case "lease":
    case "loan":
      return item.project_id ? `/projects/${item.project_id}` : null;
  }
}

// Ημερολόγιο: every dated thing in one month -- the planner's own items and
// the money calendar (payments, installments, VAT/withholding filings,
// lease and loan dates) from v_calendar_items. ?src= narrows to chosen
// sources, ?fin=0 hides the financial ones.
export async function CalendarView({ ctx, params }: { ctx: Ctx; params: SearchParams }) {
  const monthKey = parseMonthParam(params.month, ctx.today);
  const range = monthGridRange(monthKey);

  const rawSources = typeof params.src === "string" ? params.src.split(",") : [];
  const sources = rawSources.filter(isCalendarSource);
  const showFinancial = ctx.caps.canSeeFinancial && params.fin !== "0";

  const items = filterCalendarItems(
    await loadCalendarItems(ctx.supabase, range, { orgId: ctx.orgId, projectId: ctx.filters.projectId }),
    { sources, showFinancial },
  );

  const toggleSource = (s: string) => {
    const next = sources.includes(s as (typeof sources)[number]) ? sources.filter((x) => x !== s) : [...sources, s];
    return withParam(BASE, params, "src", next.length ? next.join(",") : null);
  };
  const visibleSources = CALENDAR_SOURCES.filter((s) => showFinancial || !FINANCIAL_SOURCES.has(s));

  return (
    <div className="flex flex-col gap-4">
      <Toolbar label={el.planner.tabs.calendar}>
        <Suspense>
          <PlannerFilters projects={ctx.projects.map((p) => ({ id: p.id, label: p.display_name }))} showSearch={false} />
        </Suspense>
      </Toolbar>
      <div className="flex flex-wrap gap-2">
        {/* No source picked = all of them; said with its own chip. */}
        <FilterChip href={withParam(BASE, params, "src", null)} active={sources.length === 0} className="max-md:min-h-11">
          {el.planner.calendar.all}
        </FilterChip>
        {visibleSources.map((s) => (
          <FilterChip key={s} href={toggleSource(s)} active={sources.includes(s)} className="max-md:min-h-11">
            {el.planner.source[s]}
          </FilterChip>
        ))}
        {ctx.caps.canSeeFinancial && (
          <FilterChip
            href={withParam(BASE, params, "fin", showFinancial ? "0" : null)}
            active={showFinancial}
            className="max-md:min-h-11"
          >
            {el.planner.calendar.financial}: {showFinancial ? "✓" : "—"}
          </FilterChip>
        )}
      </div>
      <PlannerCalendar
        items={items}
        monthKey={monthKey}
        today={ctx.today}
        nav={{
          prev: withParam(BASE, params, "month", addMonths(monthKey, -1)),
          next: withParam(BASE, params, "month", addMonths(monthKey, 1)),
          today: withParam(BASE, params, "month", null),
        }}
        hrefFor={calendarHrefFor}
        sources={sources.length ? visibleSources.filter((s) => sources.includes(s)) : visibleSources}
      />
    </div>
  );
}
