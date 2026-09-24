"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { PROJECT_NOTE_KIND, PROJECT_NOTE_SEVERITY, type ProjectNoteKind, type ProjectNoteSeverity } from "@/lib/domain/enums";

const KIND_LABELS: Record<ProjectNoteKind, string> = {
  status: "Κατάσταση",
  risk: "Ρίσκο",
  action: "Ενέργεια",
  milestone: "Ορόσημο",
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

  if (!open) {
    return (
      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
        {trigger ?? "+ Σημείωση"}
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded bg-white p-5">
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
                {PROJECT_NOTE_KIND.map((k) => (
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
      </div>
    </div>
  );
}
