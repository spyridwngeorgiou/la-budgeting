"use client";

import { useState } from "react";
import { Button, Input, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

type BudgetLineCode = "acquisition" | "studies_permits_legal" | "construction_equipment" | "other";

interface Props {
  action: (formData: FormData) => Promise<void>;
  initial?: {
    contingency_pct?: number;
    lines?: Partial<Record<BudgetLineCode, number>>;
  };
}

const LINE_LABELS: Record<BudgetLineCode, string> = {
  acquisition: "Απόκτηση / δικαιώματα",
  studies_permits_legal: "Μελέτες, άδειες, νομικά",
  construction_equipment: "Κατασκευή & εξοπλισμός",
  other: "Λοιπά κόστη",
};

export function BudgetFormModal({ action, initial }: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {initial ? "Επεξεργασία Προϋπολογισμού" : "+ Προϋπολογισμός"}
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded bg-white p-5">
        <form
          action={async (formData) => {
            await action(formData);
            setOpen(false);
          }}
          className="flex flex-col gap-3"
        >
          {Object.entries(LINE_LABELS).map(([code, label]) => (
            <Field key={code}>
              <Label>{label}</Label>
              <Input
                type="number"
                step="0.01"
                name={`line_${code}`}
                defaultValue={initial?.lines?.[code as BudgetLineCode]}
              />
            </Field>
          ))}
          <Field>
            <Label>Απρόβλεπτα (%)</Label>
            <Input type="number" step="0.01" name="contingency_pct" defaultValue={initial?.contingency_pct ?? 0} />
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
