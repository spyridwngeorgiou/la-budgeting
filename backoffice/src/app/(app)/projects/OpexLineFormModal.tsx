"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { OPEX_LINE_KIND, type OpexLineKind } from "@/lib/domain/enums";

const KIND_LABELS: Record<OpexLineKind, string> = {
  payroll: "Μισθοδοσία",
  pct_of_revenue: "Ποσοστό επί τζίρου",
  fixed_annual: "Σταθερό ετήσιο",
};

export interface OpexLineInitial {
  id?: string;
  kind?: OpexLineKind;
  label?: string;
  from_operating_year?: number;
  to_operating_year?: number | null;
  headcount?: number | null;
  monthly_wage?: number | null;
  salaries_per_year?: number | null;
  employer_contribution_pct?: number | null;
  premium_pct?: number | null;
  months_active?: number | null;
  pct_of_revenue?: number | null;
  annual_amount?: number | null;
  note?: string | null;
}

// Same three shapes the DB constraints enforce (opex_payroll_shape /
// opex_pct_shape / opex_fixed_shape in migration 0021) -- the form only
// shows the fields relevant to whichever kind is selected, same
// conditional-field pattern as document review's has_invoice toggle.
export function OpexLineFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<void>;
  initial?: OpexLineInitial;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<OpexLineKind>(initial?.kind ?? "fixed_annual");

  if (!open) {
    return (
      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
        {trigger ?? "+ Γραμμή Opex"}
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
            <Label>Τύπος</Label>
            <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as OpexLineKind)}>
              {OPEX_LINE_KIND.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>

          {kind === "payroll" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label>Θέσεις (headcount)</Label>
                  <Input type="number" step="0.01" name="headcount" defaultValue={initial?.headcount ?? ""} required />
                </Field>
                <Field>
                  <Label>Μηνιαίος μισθός (€)</Label>
                  <Input type="number" step="0.01" name="monthly_wage" defaultValue={initial?.monthly_wage ?? ""} required />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label>Μισθοί/έτος (π.χ. 14)</Label>
                  <Input type="number" step="0.5" name="salaries_per_year" defaultValue={initial?.salaries_per_year ?? 14} required />
                </Field>
                <Field>
                  <Label>Μήνες ενεργό</Label>
                  <Input type="number" min={1} max={12} name="months_active" defaultValue={initial?.months_active ?? 12} required />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <Label>Εργοδοτικές εισφορές (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    name="employer_contribution_pct_pct"
                    defaultValue={initial?.employer_contribution_pct != null ? initial.employer_contribution_pct * 100 : 21.79}
                  />
                </Field>
                <Field>
                  <Label>Πριμ νυχτ./αργιών (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    name="premium_pct_pct"
                    defaultValue={initial?.premium_pct != null ? initial.premium_pct * 100 : 0}
                  />
                </Field>
              </div>
            </>
          )}

          {kind === "pct_of_revenue" && (
            <Field>
              <Label>Ποσοστό επί τζίρου (%)</Label>
              <Input
                type="number"
                step="0.01"
                name="pct_of_revenue_pct"
                defaultValue={initial?.pct_of_revenue != null ? initial.pct_of_revenue * 100 : ""}
                required
              />
            </Field>
          )}

          {kind === "fixed_annual" && (
            <Field>
              <Label>Ετήσιο ποσό (€)</Label>
              <Input type="number" step="0.01" name="annual_amount" defaultValue={initial?.annual_amount ?? ""} required />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>Από λειτουργικό έτος</Label>
              <Input type="number" min={1} name="from_operating_year" defaultValue={initial?.from_operating_year ?? 1} required />
            </Field>
            <Field>
              <Label>Έως λειτουργικό έτος (προαιρετικό)</Label>
              <Input type="number" min={1} name="to_operating_year" defaultValue={initial?.to_operating_year ?? ""} />
            </Field>
          </div>
          <Field>
            <Label>Σημείωση</Label>
            <Input name="note" defaultValue={initial?.note ?? ""} />
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
