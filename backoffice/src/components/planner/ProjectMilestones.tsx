"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { errorOf } from "@/lib/actions";
import { formatDate } from "@/lib/format";
import type { MilestoneKind } from "@/lib/domain/enums";
import { deleteMilestone, saveMilestone, setMilestoneDone } from "@/app/(app)/planner/actions";
import { MilestoneFormModal } from "./ScheduleFormModals";

export interface ProjectMilestone {
  id: string;
  title: string;
  description: string | null;
  kind: MilestoneKind;
  due_date: string;
  done_at: string | null;
}

// 44px touch targets on phones for the row buttons.
const TAP = "max-md:min-h-11 max-md:min-w-11";

async function run(p: Promise<unknown>) {
  const message = errorOf(await p);
  if (message) window.alert(message);
}

// The project's milestones on its page (they used to be editable only in the
// planner's timeline). The ids travel as plain props and each action is
// called with them here -- no per-row server-side .bind (AGENTS.md).
export function ProjectMilestones({
  projectId,
  milestones,
  today,
  canEdit,
}: {
  projectId: string;
  milestones: ProjectMilestone[];
  today: string;
  canEdit: boolean;
}) {
  const m = el.planner.milestone;
  return (
    <div className="flex flex-col gap-1 border-t border-hairline pt-2">
      <p className="eyebrow text-muted">{el.planner.milestones}</p>
      {milestones.length === 0 ? (
        <p className="text-small text-muted">{m.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {milestones.map((x) => {
            const late = !x.done_at && x.due_date < today;
            return (
              <li
                key={x.id}
                className="flex flex-col gap-1 border-b border-hairline py-1.5 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-3"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className={`truncate ${x.done_at ? "text-muted line-through" : "text-ink"}`}>{x.title}</span>
                  {x.kind !== "general" && (
                    <span className="shrink-0 text-small text-muted">{el.planner.milestoneKind[x.kind]}</span>
                  )}
                  <span className={`num shrink-0 text-small ${late ? "text-negative" : "text-muted"}`}>
                    {formatDate(x.due_date)}
                  </span>
                </span>
                {canEdit && (
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    <form action={() => run(setMilestoneDone(projectId, x.id, !x.done_at))}>
                      <SubmitButton variant="secondary" size="sm" className={TAP} aria-label={x.done_at ? m.reopen : m.done}>
                        {x.done_at ? m.reopen : "✓"}
                      </SubmitButton>
                    </form>
                    <MilestoneFormModal
                      action={(formData) => saveMilestone(projectId, x.id, formData)}
                      trigger={el.common.edit}
                      initial={x}
                    />
                    <form
                      action={() => run(deleteMilestone(projectId, x.id))}
                      onSubmit={(e) => {
                        if (!window.confirm(m.deleteConfirm)) e.preventDefault();
                      }}
                    >
                      <SubmitButton variant="ghost" size="sm" className={TAP} aria-label={el.common.delete}>
                        ×
                      </SubmitButton>
                    </form>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <div className="pt-1">
          <MilestoneFormModal action={(formData) => saveMilestone(projectId, null, formData)} />
        </div>
      )}
    </div>
  );
}
