import { Segmented } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { planner } from "@/lib/i18n/v2/planner";
import { withParams } from "@/lib/url";

// /planner is one page with two views: ?view=board (the default, so the
// param is left out) or timeline. The old /planner/timeline URL redirects
// here; /planner/calendar and ?view=calendar go to /calendar
// (src/lib/redirects.ts).

export const PLANNER_VIEWS = ["board", "timeline"] as const;
export type PlannerView = (typeof PLANNER_VIEWS)[number];

type SearchParams = Record<string, string | string[] | undefined>;

export function parsePlannerView(v: string | string[] | undefined): PlannerView {
  const one = Array.isArray(v) ? v[0] : v;
  return (PLANNER_VIEWS as readonly string[]).includes(one ?? "") ? (one as PlannerView) : "board";
}

// A link to `view` that keeps every other filter (project, assignee, month…).
export function plannerHref(params: SearchParams, view: PlannerView, base = "/planner"): string {
  return withParams(base, params, { view: view === "board" ? null : view });
}

export function PlannerViews({ params, active }: { params: SearchParams; active: PlannerView }) {
  return (
    <Segmented
      label={planner.views.label}
      active={active}
      // 44px touch targets on phones; the chips' own 36px on desktop.
      className="max-md:w-full max-md:[&>a]:min-h-11 max-md:[&>a]:flex-1 max-md:[&>a]:justify-center"
      options={PLANNER_VIEWS.map((v) => ({ key: v, label: el.planner.tabs[v], href: plannerHref(params, v) }))}
    />
  );
}
