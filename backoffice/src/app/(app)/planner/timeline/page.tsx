import { Suspense } from "react";
import { Button } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { loadSchedule } from "@/lib/planner/queries";
import { Timeline, type TimelineGroup } from "@/components/planner/Timeline";
import { PlannerFilters } from "@/components/planner/PlannerNav";
import { MilestoneFormModal, PhaseFormModal } from "@/components/planner/ScheduleFormModals";
import { plannerContext } from "../context";
import { deleteMilestone, deletePhase, saveMilestone, savePhase, setMilestoneDone } from "../actions";

// Χρονοδιάγραμμα: phases (planned vs actual), milestones and dated tasks on
// one axis. Editing the skeleton needs one project selected, so a new phase
// or milestone always knows where it belongs.
export default async function PlannerTimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await plannerContext(params);
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Suspense>
          <PlannerFilters projects={projects.map((p) => ({ id: p.id, label: p.display_name }))} showSearch={false} />
        </Suspense>
        {editable && filters.projectId && (
          <div className="flex gap-2">
            <PhaseFormModal action={savePhase.bind(null, filters.projectId, null)} />
            <MilestoneFormModal
              action={saveMilestone.bind(null, filters.projectId, null)}
              phases={phaseOptions(filters.projectId)}
            />
          </div>
        )}
      </div>
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
                    <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs" aria-label={el.common.delete}>
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
                    <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
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
                    <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs" aria-label={el.common.delete}>
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
