import Link from "next/link";
import { Suspense } from "react";
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
import { PlannerCalendar } from "@/components/planner/PlannerCalendar";
import { PlannerFilters } from "@/components/planner/PlannerNav";
import { plannerContext, withParam } from "../context";

const BASE = "/planner/calendar";

function hrefFor(item: CalendarItem): string | null {
  switch (item.source) {
    case "task":
      return item.ref_id ? `/planner/task/${item.ref_id}` : null;
    case "milestone":
    case "phase":
      return item.project_id ? `/planner/timeline?project=${item.project_id}` : null;
    case "project":
      return `/projects/${item.ref_id}`;
    case "payment":
    case "installment":
      return item.ref_id ? `/transactions?ids=${item.ref_id}` : null;
    case "vat":
      return "/vat";
    case "withholding":
      return "/withholding";
    case "lease":
    case "loan":
      return item.project_id ? `/projects/${item.project_id}` : null;
  }
}

// Ημερολόγιο: every dated thing in one month -- the planner's own items and
// the money calendar (payments, installments, VAT/withholding filings,
// lease and loan dates) from v_calendar_items. ?src= narrows to chosen
// sources, ?fin=0 hides the financial ones.
export default async function PlannerCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await plannerContext(params);
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Suspense>
          <PlannerFilters projects={ctx.projects.map((p) => ({ id: p.id, label: p.display_name }))} showSearch={false} />
        </Suspense>
        <div className="flex flex-wrap gap-1 text-xs">
          {visibleSources.map((s) => {
            const on = sources.includes(s);
            return (
              <Link
                key={s}
                href={toggleSource(s)}
                className={`rounded-full border px-2.5 py-1 ${
                  on ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-muted hover:bg-bg"
                }`}
              >
                {el.planner.source[s]}
              </Link>
            );
          })}
          {ctx.caps.canSeeFinancial && (
            <Link
              href={withParam(BASE, params, "fin", showFinancial ? "0" : null)}
              className={`rounded-full border px-2.5 py-1 ${
                showFinancial ? "border-amber-ink/40 bg-amber-bg text-amber-ink" : "border-line-strong text-ink-faint"
              }`}
            >
              {el.planner.calendar.financial}: {showFinancial ? "✓" : "—"}
            </Link>
          )}
        </div>
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
        hrefFor={hrefFor}
      />
    </div>
  );
}
