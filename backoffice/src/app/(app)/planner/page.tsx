import { PageHeader } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { plannerContext } from "./context";
import { BoardView } from "./views";

// Πλάνο: the task board. The timeline view and phases were removed (0093);
// /planner/timeline and ?view=timeline land here, and the month calendar is
// /calendar (?view=calendar redirects there) -- src/lib/redirects.ts.
// Milestones are edited on the project page («Πλάνο» section).
export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await plannerContext(params);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={el.planner.title} />
      <BoardView ctx={ctx} />
    </div>
  );
}
