import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { TASK_STATUS } from "@/lib/domain/enums";
import { todayAthens } from "@/lib/dates";
import { OnePagerSection } from "@/components/onepager";
import { STATUS_DOT } from "./labels";
import { ProjectMilestones } from "./ProjectMilestones";

// «Πλάνο έργου» on the project one-pager: open work by status and overdue
// count (a way into /planner for this project), and the project's
// milestones -- listed and, for org editors, added, edited and deleted here.
// Fetches its own data so the (already long) project page query stays as is.
export async function ProjectPlanSection({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const today = todayAthens();
  const [{ data: tasks }, { data: milestones }] = await Promise.all([
    supabase.from("tasks").select("status, due_date").eq("project_id", projectId).is("archived_at", null),
    // Open ones first (by date), then the reached ones.
    supabase
      .from("project_milestones")
      .select("id, title, description, kind, due_date, done_at")
      .eq("project_id", projectId)
      .order("done_at", { nullsFirst: true })
      .order("due_date")
      .limit(100),
  ]);

  const open = (tasks ?? []).filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due_date && t.due_date < today).length;
  const counts = TASK_STATUS.filter((s) => s !== "done").map((s) => [s, open.filter((t) => t.status === s).length] as const);

  return (
    <OnePagerSection title={el.planner.projectSection}>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-ink">
            {open.length} {el.planner.openTasks}
          </span>
          {counts
            .filter(([, n]) => n > 0)
            .map(([s, n]) => (
              <span key={s} className="flex items-center gap-1.5 text-xs text-muted">
                <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                {el.planner.status[s]} {n}
              </span>
            ))}
          {overdue > 0 && (
            <span className="border-l-2 border-negative pl-2 text-xs font-medium text-negative">
              {overdue} {el.planner.task.overdue}
            </span>
          )}
        </div>
        <ProjectMilestones projectId={projectId} milestones={milestones ?? []} today={today} canEdit={canEdit} />
        <div className="flex flex-wrap gap-x-4 border-t border-hairline pt-1 text-small">
          <Link href={`/planner?project=${projectId}`} className="inline-flex min-h-10 items-center text-ink hover:underline">
            {el.planner.tabs.board} →
          </Link>
          <Link href={`/calendar?project=${projectId}`} className="inline-flex min-h-10 items-center text-ink hover:underline">
            {el.planner.tabs.calendar} →
          </Link>
        </div>
      </div>
    </OnePagerSection>
  );
}
