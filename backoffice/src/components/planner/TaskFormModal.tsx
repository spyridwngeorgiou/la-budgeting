"use client";

import { useState } from "react";
import { Button, Field, FormDrawer, Input, Label, Select, Textarea } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { TASK_PRIORITY, TASK_STATUS, type TaskPriority, type TaskStatus } from "@/lib/domain/enums";

export interface Option {
  id: string;
  label: string;
}

export interface TaskInitial {
  project_id?: string;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  phase_id?: string | null;
  milestone_id?: string | null;
}

// The task's editable fields, shared by the create modal and the detail
// page's edit form. `projects` with more than one entry renders a picker;
// otherwise the project travels as a hidden field.
export function TaskFields({
  initial,
  projects,
  people,
  phases,
  milestones,
  canMoveProject = true,
}: {
  initial?: TaskInitial;
  projects: Option[];
  people: Option[];
  phases?: Option[];
  milestones?: Option[];
  canMoveProject?: boolean;
}) {
  const t = el.planner.task;
  const projectId = initial?.project_id ?? projects[0]?.id ?? "";
  return (
    <div className="flex flex-col gap-4">
      {projects.length > 1 && canMoveProject ? (
        <Field>
          <Label>{el.planner.project}</Label>
          <Select name="project_id" defaultValue={projectId} required>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="project_id" value={projectId} />
      )}
      <Field>
        <Label>{t.title}</Label>
        <Input name="title" defaultValue={initial?.title ?? ""} required maxLength={500} />
      </Field>
      <Field>
        <Label>{t.description}</Label>
        <Textarea name="description" defaultValue={initial?.description ?? ""} rows={3} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <Label>{t.status}</Label>
          <Select name="status" defaultValue={initial?.status ?? "todo"}>
            {TASK_STATUS.map((s) => (
              <option key={s} value={s}>
                {el.planner.status[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label>{t.priority}</Label>
          <Select name="priority" defaultValue={initial?.priority ?? "normal"}>
            {TASK_PRIORITY.map((p) => (
              <option key={p} value={p}>
                {el.planner.priority[p]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field>
        <Label>{el.planner.assignee}</Label>
        <Select name="assignee_id" defaultValue={initial?.assignee_id ?? ""}>
          <option value="">{el.planner.unassigned}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <Label>{t.start}</Label>
          <Input type="date" name="start_date" defaultValue={initial?.start_date ?? ""} />
        </Field>
        <Field>
          <Label>{t.due}</Label>
          <Input type="date" name="due_date" defaultValue={initial?.due_date ?? ""} />
        </Field>
      </div>
      {(phases || milestones) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {phases && (
            <Field>
              <Label>{t.phase}</Label>
              <Select name="phase_id" defaultValue={initial?.phase_id ?? ""}>
                <option value="">{t.none}</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {milestones && (
            <Field>
              <Label>{t.milestone}</Label>
              <Select name="milestone_id" defaultValue={initial?.milestone_id ?? ""}>
                <option value="">{t.none}</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskFormModal({
  action,
  projects,
  people,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<unknown>;
  projects: Option[];
  people: Option[];
  initial?: TaskInitial;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);

  // The page's one primary action; the form opens in a drawer (full screen
  // on a phone). FormDrawer shows a returned or thrown error above the
  // buttons and keeps the drawer open.
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={projects.length === 0}>
        {trigger ?? el.planner.newTask}
      </Button>
      {open && (
        <FormDrawer
          onClose={() => setOpen(false)}
          action={action}
          eyebrow={el.planner.title}
          title={(trigger ?? el.planner.newTask).replace(/^\+\s*/, "")}
        >
          <TaskFields initial={initial} projects={projects} people={people} />
        </FormDrawer>
      )}
    </>
  );
}
