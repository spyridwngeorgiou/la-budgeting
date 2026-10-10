import { ButtonLink, DataTable, SectionHeader, StatusDot } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { projects } from "@/lib/i18n/v2/projects";
import { loadBoardTasks, loadPlannerPeople, loadSchedule } from "@/lib/planner/queries";
import { plannerCapabilities } from "@/lib/planner/access";
import { TaskBoard } from "@/components/planner/TaskBoard";
import { moveTask, setTaskStatus } from "@/app/(app)/planner/actions";
import { requireTab } from "./data";

const t = projects.plan;
const PHASE_TONE = { planned: "neutral", active: "navy", on_hold: "warning", done: "positive" } as const;

// Πλάνο: this project's phases, milestones and task board -- the planner's
// own read paths (lib/planner/queries.ts) and kanban, scoped to the
// project. Editing the schedule and creating tasks stay in /planner.
export async function PlanTab({ id }: { id: string }) {
  const core = await requireTab(id, "plan");
  const { supabase, today, role } = core;
  const caps =
    role && role !== "partner" ? plannerCapabilities({ kind: "member", role }) : plannerCapabilities({ kind: "partner", projectRole: "guest" });

  const [schedule, tasks, people] = await Promise.all([
    loadSchedule(supabase, [id]),
    loadBoardTasks(supabase, [id], { projectId: id }),
    loadPlannerPeople(supabase, id),
  ]);

  return (
    <div className="flex flex-col gap-12">
      <div className="flex justify-end">
        <ButtonLink href={`/planner?project=${id}`}>{t.open} →</ButtonLink>
      </div>

      <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-2">
        <section className="flex flex-col gap-4">
          <SectionHeader numeral={1} title={t.phases} />
          <DataTable
            rows={schedule.phases}
            rowKey={(p) => p.id}
            empty={t.noPhases}
            columns={[
              { key: "name", header: el.planner.phase.name, primary: true, cell: (p) => p.name },
              {
                key: "status",
                header: t.status,
                cell: (p) => <StatusDot tone={PHASE_TONE[p.status]} label={el.planner.phaseStatus[p.status]} />,
              },
              {
                key: "planned",
                header: t.planned,
                numeric: true,
                cell: (p) => [p.actual_start ?? p.planned_start, p.actual_end ?? p.planned_end].map((d) => (d ? formatDate(d) : "…")).join(" – "),
              },
            ]}
          />
        </section>

        <section className="flex flex-col gap-4">
          <SectionHeader numeral={2} title={t.milestones} />
          <DataTable
            rows={schedule.milestones}
            rowKey={(m) => m.id}
            empty={t.noMilestones}
            columns={[
              { key: "title", header: el.planner.milestone.title, primary: true, cell: (m) => m.title },
              { key: "kind", header: el.planner.milestone.kind, cell: (m) => el.planner.milestoneKind[m.kind] },
              {
                key: "due",
                header: t.due,
                numeric: true,
                cell: (m) =>
                  m.done_at ? (
                    <StatusDot tone="positive" label={`${t.done} · ${formatDate(m.due_date)}`} />
                  ) : (
                    <span className={m.due_date < today ? "text-negative" : undefined}>{formatDate(m.due_date)}</span>
                  ),
              },
            ]}
          />
        </section>
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader numeral={3} title={t.tasks} />
        <TaskBoard
          tasks={tasks}
          people={people}
          canWrite={caps.canWriteTasks}
          todayIso={today}
          taskHref="/planner/task"
          moveAction={moveTask}
          setStatusAction={setTaskStatus}
        />
      </section>
    </div>
  );
}
