import { PageHeader } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { PlannerViews, parsePlannerView } from "@/components/planner/PlannerViews";
import { plannerContext } from "./context";
import { BoardView, TimelineView } from "./views";

// Πλάνο: one page, two views (?view=board|timeline; board when absent). The
// switch keeps every other filter, so "this project's board" becomes "this
// project's timeline" in one click. The month calendar is /calendar
// (?view=calendar redirects there, src/lib/redirects.ts).
export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view = parsePlannerView(params.view);
  const ctx = await plannerContext(params);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={el.planner.title}>
        <PlannerViews params={params} active={view} />
      </PageHeader>
      {view === "timeline" ? <TimelineView ctx={ctx} /> : <BoardView ctx={ctx} />}
    </div>
  );
}
