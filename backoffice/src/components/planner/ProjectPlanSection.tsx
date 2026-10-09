import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { el } from "@/lib/i18n/el";
import { formatDate } from "@/lib/format";
import { TASK_STATUS } from "@/lib/domain/enums";
import { todayAthens } from "@/lib/planner/dates";
import { OnePagerSection } from "@/components/onepager";
import { STATUS_DOT } from "./labels";

// «Πλάνο έργου» on the project one-pager: open work by status, overdue
// count and the next milestones, each a way into /planner for this project.
// Fetches its own data so the (already long) project page query stays as is.
export async function ProjectPlanSection({ projectId }: { projectId: string }) {
  const supabase = await createClient();
  const today = todayAthens();
  const [{ data: tasks }, { data: milestones }, { data: phase }] = await Promise.all([
    supabase.from("tasks").select("status, due_date").eq("project_id", projectId).is("archived_at", null),
    supabase
      .from("project_milestones")
      .select("id, title, due_date")
      .eq("project_id", projectId)
      .is("done_at", null)
      .order("due_date")
      .limit(3),
    supabase
      .from("project_phases")
      .select("name")
      .eq("project_id", projectId)
      .eq("status", "active")
      .order("sort_order")
      .limit(1)
      .maybeSingle(),
  ]);

  const open = (tasks ?? []).filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due_date && t.due_date < today).length;
  const counts = TASK_STATUS.filter((s) => s !== "done").map((s) => [s, open.filter((t) => t.status === s).length] as const);

  return (
    <OnePagerSection title={el.planner.projectSection} subtitle={phase?.name ?? undefined}>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-ink">
            {open.length} {el.planner.openTasks}
          </span>
          {counts
            .filter(([, n]) => n > 0)
            .map(([s, n]) => (
              <span key={s} className="flex items-center gap-1 text-xs text-ink-muted">
                <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                {el.planner.status[s]} {n}
              </span>
            ))}
          {overdue > 0 && (
            <span className="text-xs font-medium text-red-ink">
              {overdue} {el.planner.task.overdue}
            </span>
          )}
        </div>
        {milestones && milestones.length > 0 && (
          <ul className="flex flex-col gap-1 border-t border-line/60 pt-2">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-ink">{m.title}</span>
                <span className={`shrink-0 text-xs ${m.due_date < today ? "text-red-ink" : "text-ink-muted"}`}>
                  {formatDate(m.due_date)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-3 border-t border-line/60 pt-2 text-xs">
          <Link href={`/planner?project=${projectId}`} className="text-ink hover:underline">
            {el.planner.tabs.board} →
          </Link>
          <Link href={`/planner/timeline?project=${projectId}`} className="text-ink hover:underline">
            {el.planner.tabs.timeline} →
          </Link>
          <Link href={`/planner/calendar?project=${projectId}`} className="text-ink hover:underline">
            {el.planner.tabs.calendar} →
          </Link>
        </div>
      </div>
    </OnePagerSection>
  );
}
