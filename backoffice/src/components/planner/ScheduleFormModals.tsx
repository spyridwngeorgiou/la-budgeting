"use client";

import { useState } from "react";
import { Button, Field, Input, Label, Select } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { MILESTONE_KIND, PHASE_STATUS, type MilestoneKind, type PhaseStatus } from "@/lib/domain/enums";
import type { Option } from "./TaskFormModal";
import { FormModal } from "@/components/Modal";

// Phase and milestone editors for the timeline -- the schedule skeleton,
// org editors only (RLS refuses everyone else; the page doesn't render
// these for them either).

function ScheduleModal({
  trigger,
  small,
  action,
  children,
}: {
  trigger: string;
  small?: boolean;
  action: (formData: FormData) => Promise<unknown>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className={small ? "!px-2 !py-1 text-xs" : ""} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      {open && (
        <FormModal
          onClose={() => setOpen(false)}
          action={action}
          className="max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded bg-white p-5"
        >
          {children}
        </FormModal>
      )}
    </>
  );
}

export interface PhaseInitial {
  name?: string;
  status?: PhaseStatus;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  sort_order?: number;
}

export function PhaseFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<unknown>;
  initial?: PhaseInitial;
  trigger?: string;
}) {
  const p = el.planner.phase;
  return (
    <ScheduleModal trigger={trigger ?? el.planner.newPhase} small={!!initial} action={action}>
      <Field>
        <Label>{p.name}</Label>
        <Input name="name" defaultValue={initial?.name ?? ""} required maxLength={500} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <Label>{el.planner.task.status}</Label>
          <Select name="status" defaultValue={initial?.status ?? "planned"}>
            {PHASE_STATUS.map((s) => (
              <option key={s} value={s}>
                {el.planner.phaseStatus[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label>#</Label>
          <Input type="number" name="sort_order" min={0} defaultValue={initial?.sort_order ?? 0} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <Label>{p.plannedStart}</Label>
          <Input type="date" name="planned_start" defaultValue={initial?.planned_start ?? ""} />
        </Field>
        <Field>
          <Label>{p.plannedEnd}</Label>
          <Input type="date" name="planned_end" defaultValue={initial?.planned_end ?? ""} />
        </Field>
        <Field>
          <Label>{p.actualStart}</Label>
          <Input type="date" name="actual_start" defaultValue={initial?.actual_start ?? ""} />
        </Field>
        <Field>
          <Label>{p.actualEnd}</Label>
          <Input type="date" name="actual_end" defaultValue={initial?.actual_end ?? ""} />
        </Field>
      </div>
    </ScheduleModal>
  );
}

export interface MilestoneInitial {
  title?: string;
  description?: string | null;
  kind?: MilestoneKind;
  due_date?: string;
  phase_id?: string | null;
}

export function MilestoneFormModal({
  action,
  phases,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<unknown>;
  phases: Option[];
  initial?: MilestoneInitial;
  trigger?: string;
}) {
  const m = el.planner.milestone;
  return (
    <ScheduleModal trigger={trigger ?? el.planner.newMilestone} small={!!initial} action={action}>
      <Field>
        <Label>{m.title}</Label>
        <Input name="title" defaultValue={initial?.title ?? ""} required maxLength={500} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <Label>{m.kind}</Label>
          <Select name="kind" defaultValue={initial?.kind ?? "general"}>
            {MILESTONE_KIND.map((k) => (
              <option key={k} value={k}>
                {el.planner.milestoneKind[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label>{m.due}</Label>
          <Input type="date" name="due_date" defaultValue={initial?.due_date ?? ""} required />
        </Field>
      </div>
      <Field>
        <Label>{el.planner.task.phase}</Label>
        <Select name="phase_id" defaultValue={initial?.phase_id ?? ""}>
          <option value="">{el.planner.task.none}</option>
          {phases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <Label>{el.planner.task.description}</Label>
        <textarea
          name="description"
          defaultValue={initial?.description ?? ""}
          rows={2}
          className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-sage-strong focus:outline-none"
        />
      </Field>
    </ScheduleModal>
  );
}
