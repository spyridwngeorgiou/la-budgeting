"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { LIABILITY_STATE, type LiabilityState } from "@/lib/domain/enums";

const STATE_LABELS: Record<LiabilityState, string> = {
  in_application: "Σε αίτηση",
  approved: "Εγκεκριμένο",
  disbursed: "Εκταμιευμένο",
  repaid: "Αποπληρωμένο",
};

export interface LoanInitial {
  id?: string;
  label?: string;
  principal?: number;
  interest_rate?: number;
  term_years?: number;
  grace_years?: number;
  first_amortisation_month?: string | null;
  state?: LiabilityState;
  notes?: string | null;
}

export function LoanFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<void>;
  initial?: LoanInitial;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
        {trigger ?? "+ Δάνειο"}
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
            <Label>Ετικέτα</Label>
            <Input name="label" defaultValue={initial?.label} required />
          </Field>
          <Field>
            <Label>Κεφάλαιο (€)</Label>
            <Input type="number" step="0.01" name="principal" defaultValue={initial?.principal} required />
          </Field>
          <Field>
            <Label>Επιτόκιο (ετήσιο, %)</Label>
            <Input
              type="number"
              step="0.001"
              name="interest_rate_pct"
              defaultValue={initial?.interest_rate != null ? initial.interest_rate * 100 : undefined}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>Διάρκεια (έτη)</Label>
              <Input type="number" name="term_years" defaultValue={initial?.term_years} required />
            </Field>
            <Field>
              <Label>Χάρη (έτη)</Label>
              <Input type="number" name="grace_years" defaultValue={initial?.grace_years ?? 0} />
            </Field>
          </div>
          <Field>
            <Label>Πρώτος μήνας εξόφλησης</Label>
            <Input type="date" name="first_amortisation_month" defaultValue={initial?.first_amortisation_month ?? ""} />
          </Field>
          <Field>
            <Label>Κατάσταση</Label>
            <Select name="state" defaultValue={initial?.state ?? "in_application"}>
              {LIABILITY_STATE.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </Select>
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
