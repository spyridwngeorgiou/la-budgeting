import { Suspense } from "react";
import { EmptyState, Toolbar } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { loadBoardTasks, loadPlannerPeople } from "@/lib/planner/queries";
import { TaskBoard } from "@/components/planner/TaskBoard";
import { TaskFormModal } from "@/components/planner/TaskFormModal";
import { PlannerFilters } from "@/components/planner/PlannerNav";
import type { plannerContext } from "./context";
import { createTask, moveTask, setTaskStatus } from "./actions";

// The body of /planner. The month calendar is its own page: /calendar
// (../calendar/CalendarView.tsx).

type Ctx = Awaited<ReturnType<typeof plannerContext>>;
// Εργασίες: the kanban. Without ?project it spans every project of the
// current org, with each card naming its project.
export async function BoardView({ ctx }: { ctx: Ctx }) {
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
    <div className="flex flex-col gap-4">
      <Toolbar
        label={el.planner.title}
        actions={
          caps.canWriteTasks && (
            <TaskFormModal
              action={createTask}
              projects={projectOptions}
              people={peopleOptions}
              initial={filters.projectId ? { project_id: filters.projectId } : undefined}
            />
          )
        }
      >
        <Suspense>
          <PlannerFilters projects={projectOptions} people={peopleOptions} meId={ctx.userId} showArchived />
        </Suspense>
      </Toolbar>
      {!caps.canWriteTasks && <p className="border-l-2 border-navy pl-3 text-small text-muted">{el.planner.readOnly}</p>}
      {projects.length === 0 ? (
        <EmptyState title={el.planner.noProjects} />
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
