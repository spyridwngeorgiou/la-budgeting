"use client";

import { useState } from "react";
import { Button, Field, FormDrawer, Input, Label, Select, Textarea } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { MILESTONE_KIND, type MilestoneKind } from "@/lib/domain/enums";

// The milestone editor of the project page's «Πλάνο» section -- org editors
// only (RLS refuses everyone else; the page doesn't render it for them
// either). The form opens in a drawer (full screen on a phone); a row's own
// «Επεξεργασία» is the small trigger.

// "+ Ορόσημο" -> "Ορόσημο": the drawer's title for a new item.
const bare = (label: string) => label.replace(/^\+\s*/, "");

function ScheduleModal({
  trigger,
  small,
  eyebrow,
  title,
  action,
  children,
}: {
  trigger: string;
  small?: boolean;
  eyebrow: string;
  title: string;
  action: (formData: FormData) => Promise<unknown>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size={small ? "sm" : "md"}
        className={small ? "max-md:min-h-11" : undefined}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </Button>
      {open && (
        <FormDrawer onClose={() => setOpen(false)} action={action} eyebrow={eyebrow} title={title}>
          {children}
        </FormDrawer>
      )}
    </>
  );
}

export interface MilestoneInitial {
  title?: string;
  description?: string | null;
  kind?: MilestoneKind;
  due_date?: string;
}

export function MilestoneFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<unknown>;
  initial?: MilestoneInitial;
  trigger?: string;
}) {
  const m = el.planner.milestone;
  return (
    <ScheduleModal
      trigger={trigger ?? el.planner.newMilestone}
      small={!!initial}
      eyebrow={el.planner.task.milestone}
      title={initial?.title || bare(el.planner.newMilestone)}
      action={action}
    >
      <Field>
        <Label>{m.title}</Label>
        <Input name="title" defaultValue={initial?.title ?? ""} required maxLength={500} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <Label>{el.planner.task.description}</Label>
        <Textarea name="description" defaultValue={initial?.description ?? ""} rows={2} />
      </Field>
    </ScheduleModal>
  );
}
