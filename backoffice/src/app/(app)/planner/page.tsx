import { plannerContext } from "./context";
import { BoardView } from "./views";

// Πλάνο: the task board (its header, with «+ Εργασία», is BoardView's).
// The timeline view and phases were removed (0093); /planner/timeline and
// ?view=timeline land here, and the month calendar is /calendar
// (?view=calendar redirects there) -- src/lib/redirects.ts. Milestones are
// edited on the project page («Πλάνο» section).
export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await plannerContext(params);

  return <BoardView ctx={ctx} />;
}
