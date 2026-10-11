import { Suspense } from "react";
import { Button, EmptyState, Toolbar } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { loadBoardTasks, loadPlannerPeople, loadSchedule } from "@/lib/planner/queries";
import { TaskBoard } from "@/components/planner/TaskBoard";
import { TaskFormModal } from "@/components/planner/TaskFormModal";
import { PlannerFilters } from "@/components/planner/PlannerNav";
import { Timeline, type TimelineGroup } from "@/components/planner/Timeline";
import { MilestoneFormModal, PhaseFormModal } from "@/components/planner/ScheduleFormModals";
import type { plannerContext } from "./context";
import {
  createTask,
  deleteMilestone,
  deletePhase,
  moveTask,
  saveMilestone,
  savePhase,
  setMilestoneDone,
  setTaskStatus,
} from "./actions";

// The two views of /planner (?view=board|timeline), each the body of what
// used to be its own page. Same reads, same actions. The month calendar is
// its own page now: /calendar (../calendar/CalendarView.tsx).

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

// Small row actions of the timeline: 32px on desktop, 44px on a phone.
const ROW_ACTION = "max-md:min-h-11 max-md:min-w-11";

// Χρονοδιάγραμμα: phases (planned vs actual), milestones and dated tasks on
// one axis. Editing the skeleton needs one project selected, so a new phase
// or milestone always knows where it belongs.
export async function TimelineView({ ctx }: { ctx: Ctx }) {
  const { supabase, filters, projects, caps } = ctx;
  const shown = filters.projectId ? projects.filter((p) => p.id === filters.projectId) : projects;
  const schedule = await loadSchedule(
    supabase,
    shown.map((p) => p.id),
  );

  const groups: TimelineGroup[] = shown
    .map((p) => ({
      project: { id: p.id, label: p.display_name },
      phases: schedule.phases.filter((x) => x.project_id === p.id),
      milestones: schedule.milestones.filter((x) => x.project_id === p.id),
      tasks: schedule.tasks.filter((x) => x.project_id === p.id),
    }))
    .filter((g) => filters.projectId || g.phases.length + g.milestones.length + g.tasks.length > 0);

  const phaseOptions = (projectId: string) =>
    schedule.phases.filter((p) => p.project_id === projectId).map((p) => ({ id: p.id, label: p.name }));
  const editable = caps.canEditSchedule;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        label={el.planner.title}
        actions={
          editable &&
          filters.projectId && (
            <>
              <PhaseFormModal action={savePhase.bind(null, filters.projectId, null)} />
              <MilestoneFormModal
                action={saveMilestone.bind(null, filters.projectId, null)}
                phases={phaseOptions(filters.projectId)}
              />
            </>
          )
        }
      >
        <Suspense>
          <PlannerFilters projects={projects.map((p) => ({ id: p.id, label: p.display_name }))} showSearch={false} />
        </Suspense>
      </Toolbar>
      <Timeline
        groups={groups}
        today={ctx.today}
        taskHref="/planner/task"
        renderPhaseActions={
          editable
            ? (phase) => (
                <>
                  <PhaseFormModal
                    action={savePhase.bind(null, phase.project_id, phase.id)}
                    trigger={el.common.edit}
                    initial={phase}
                  />
                  <form action={deletePhase.bind(null, phase.project_id, phase.id)}>
                    <Button type="submit" variant="ghost" size="sm" className={ROW_ACTION} aria-label={el.common.delete}>
                      ×
                    </Button>
                  </form>
                </>
              )
            : undefined
        }
        renderMilestoneActions={
          editable
            ? (m) => (
                <>
                  <form action={setMilestoneDone.bind(null, m.project_id, m.id, !m.done_at)}>
                    <Button type="submit" variant="secondary" size="sm" className={ROW_ACTION}>
                      {m.done_at ? el.planner.milestone.reopen : "✓"}
                    </Button>
                  </form>
                  <MilestoneFormModal
                    action={saveMilestone.bind(null, m.project_id, m.id)}
                    phases={phaseOptions(m.project_id)}
                    trigger={el.common.edit}
                    initial={m}
                  />
                  <form action={deleteMilestone.bind(null, m.project_id, m.id)}>
                    <Button type="submit" variant="ghost" size="sm" className={ROW_ACTION} aria-label={el.common.delete}>
                      ×
                    </Button>
                  </form>
                </>
              )
            : undefined
        }
      />
    </div>
  );
}
