"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { CAPITAL_SOURCE_KIND, type CapitalSourceKind } from "@/lib/domain/enums";

const KIND_LABELS: Record<CapitalSourceKind, string> = {
  equity: "Ίδια κεφάλαια",
  debt: "Δανεισμός (εκτός σκελών δανείου)",
  co_investor: "Συνεπενδυτής",
};

export interface CapitalSourceInitial {
  id?: string;
  kind?: CapitalSourceKind;
  contributor?: string | null;
  amount?: number;
  contributed_on?: string;
  notes?: string | null;
}

export function CapitalSourceFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<void>;
  initial?: CapitalSourceInitial;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
        {trigger ?? "+ Κεφάλαιο"}
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
          <Field>
            <Label>Είδος</Label>
            <Select name="kind" defaultValue={initial?.kind ?? "equity"}>
              {CAPITAL_SOURCE_KIND.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>Από ποιον</Label>
            <Input name="contributor" defaultValue={initial?.contributor ?? ""} placeholder="π.χ. Σπύρος, Συνεπενδυτής Χ" />
          </Field>
          <Field>
            <Label>Ποσό (€)</Label>
            <Input type="number" step="0.01" name="amount" defaultValue={initial?.amount} required />
          </Field>
          <Field>
            <Label>Ημερομηνία εισφοράς</Label>
            <Input type="date" name="contributed_on" defaultValue={initial?.contributed_on} required />
          </Field>
          <Field>
            <Label>Σημειώσεις</Label>
            <textarea
              name="notes"
              defaultValue={initial?.notes ?? ""}
              rows={2}
              className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-sage-strong focus:outline-none"
            />
          </Field>
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
