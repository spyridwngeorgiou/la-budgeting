"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export const UTILITY_KIND_LABELS = {
  electricity: "Ρεύμα (ΔΕΗ κ.λπ.)",
  water: "Νερό (ΕΥΔΑΠ)",
  internet: "Internet",
  phone: "Τηλέφωνο",
  other: "Άλλο",
} as const;

export interface UtilityInitial {
  kind?: keyof typeof UTILITY_KIND_LABELS;
  provider?: string | null;
  supply_number?: string | null;
  contract_account?: string | null;
  rf_code?: string | null;
  meter_number?: string | null;
  notes?: string | null;
}

export function UtilityFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<void>;
  initial?: UtilityInitial;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
        {trigger ?? "+ Παροχή"}
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
              <Label>Είδος</Label>
              <Select name="kind" defaultValue={initial?.kind ?? "electricity"}>
                {Object.entries(UTILITY_KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Πάροχος</Label>
              <Input name="provider" defaultValue={initial?.provider ?? ""} placeholder="ΔΕΗ, ΕΥΔΑΠ, Cosmote…" />
            </Field>
          </div>
          <Field>
            <Label>Αριθμός παροχής / γραμμής</Label>
            <Input name="supply_number" defaultValue={initial?.supply_number ?? ""} placeholder="π.χ. 6 04185949-04 9" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>Λογ. συμβολαίου</Label>
              <Input name="contract_account" defaultValue={initial?.contract_account ?? ""} />
            </Field>
            <Field>
              <Label>Μετρητής</Label>
              <Input name="meter_number" defaultValue={initial?.meter_number ?? ""} />
            </Field>
          </div>
          <Field>
            <Label>Κωδικός πληρωμής RF</Label>
            <Input name="rf_code" defaultValue={initial?.rf_code ?? ""} />
          </Field>
          <Field>
            <Label>Σημειώσεις</Label>
            <Input name="notes" defaultValue={initial?.notes ?? ""} />
          </Field>
          <p className="text-xs text-ink-muted">
            Πληρωμές που αναφέρουν τον αριθμό παροχής, συμβολαίου ή RF αντιστοιχίζονται αυτόματα σε αυτό το ακίνητο.
          </p>
          <div className="mt-1 flex justify-end gap-2">
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
