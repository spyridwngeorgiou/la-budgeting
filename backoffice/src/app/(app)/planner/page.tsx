import { Suspense } from "react";
import { el } from "@/lib/i18n/el";
import { loadBoardTasks, loadPlannerPeople } from "@/lib/planner/queries";
import { TaskBoard } from "@/components/planner/TaskBoard";
import { TaskFormModal } from "@/components/planner/TaskFormModal";
import { PlannerFilters } from "@/components/planner/PlannerNav";
import { plannerContext } from "./context";
import { createTask, moveTask, setTaskStatus } from "./actions";

// Εργασίες: the kanban. Without ?project it spans every project of the
// current org, with each card naming its project.
export default async function PlannerBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await plannerContext(params);
  const { supabase, filters, projects, caps } = ctx;

  const [tasks, people] = await Promise.all([
    loadBoardTasks(
      supabase,
      projects.map((p) => p.id),
      filters,
    ),
    loadPlannerPeople(supabase, filters.projectId),
  ]);

  const projectOptions = projects.map((p) => ({ id: p.id, label: p.display_name }));
  const peopleOptions = people.map((p) => ({ id: p.user_id, label: p.label }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Suspense>
          <PlannerFilters projects={projectOptions} people={peopleOptions} meId={ctx.userId} showArchived />
        </Suspense>
        {caps.canWriteTasks && (
          <TaskFormModal
            action={createTask}
            projects={projectOptions}
            people={peopleOptions}
            initial={filters.projectId ? { project_id: filters.projectId } : undefined}
          />
        )}
      </div>
      {!caps.canWriteTasks && <p className="text-xs text-ink-faint">{el.planner.readOnly}</p>}
      {projects.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-center text-sm text-ink-faint">
          {el.planner.noProjects}
        </p>
      ) : (
        <TaskBoard
          tasks={tasks}
          people={people}
          projectLabels={filters.projectId ? undefined : ctx.projectLabels}
          canWrite={caps.canWriteTasks && !filters.archived}
          todayIso={ctx.today}
          taskHref="/planner/task"
          moveAction={moveTask}
          setStatusAction={setTaskStatus}
        />
      )}
    </div>
  );
}
