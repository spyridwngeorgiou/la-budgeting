"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import {
  PROJECT_NOTE_KIND_ACTIVE,
  PROJECT_NOTE_SEVERITY,
  type ProjectNoteKind,
  type ProjectNoteKindActive,
  type ProjectNoteSeverity,
} from "@/lib/domain/enums";
import { Modal } from "@/components/Modal";

// Status and risk only since 0041: actions and milestones are planner tasks
// and project milestones now (the «Πλάνο έργου» section on the same page).
const KIND_LABELS: Record<ProjectNoteKindActive, string> = {
  status: "Κατάσταση",
  risk: "Ρίσκο",
};
const SEVERITY_LABELS: Record<ProjectNoteSeverity, string> = {
  info: "Ενημέρωση",
  watch: "Προσοχή",
  urgent: "Επείγον",
};

export interface ProjectNoteInitial {
  id?: string;
  kind?: ProjectNoteKind;
  severity?: ProjectNoteSeverity;
  body?: string;
  exposure_amount?: number | null;
  due_date?: string | null;
}

export function ProjectNoteFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<void>;
  initial?: ProjectNoteInitial;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
        {trigger ?? "+ Σημείωση"}
      </Button>
      {open && (
        <Modal onClose={() => setOpen(false)} className="max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded bg-white p-5" closeOnBackdrop={false}>
          <form
            action={async (formData) => {
              await action(formData);
              setOpen(false);
            }}
            className="flex flex-col gap-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label>Τύπος</Label>
                <Select name="kind" defaultValue={initial?.kind ?? "status"}>
                  {PROJECT_NOTE_KIND_ACTIVE.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label>Σοβαρότητα</Label>
                <Select name="severity" defaultValue={initial?.severity ?? "info"}>
                  {PROJECT_NOTE_SEVERITY.map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field>
              <Label>Κείμενο</Label>
              <textarea
                name="body"
                defaultValue={initial?.body ?? ""}
                rows={3}
                required
                className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-sage-strong focus:outline-none"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label>Έκθεση (€, προαιρετικό)</Label>
                <Input type="number" step="0.01" name="exposure_amount" defaultValue={initial?.exposure_amount ?? ""} />
              </Field>
              <Field>
                <Label>Προθεσμία</Label>
                <Input type="date" name="due_date" defaultValue={initial?.due_date ?? ""} />
              </Field>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Ακύρωση
              </Button>
              <SubmitButton>Αποθήκευση</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
