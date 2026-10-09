"use client";

import { useState } from "react";
import { Button, Field, Input, Label, Select } from "@/components/ui";
import { FormModal } from "@/components/Modal";
import { el } from "@/lib/i18n/el";
import type { ActionResult } from "@/lib/actions";

export interface ExpectedIncomeInitial {
  source: string;
  amount: number;
  expected_month: string | null; // 'YYYY-MM-DD'
  probability: number | null; // 0..1
  project_id: string | null;
  owner_scope: "corporate" | "personal";
  notes: string | null;
}

export function ExpectedIncomeFormModal({
  action,
  initial,
  projects,
  trigger,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  initial?: ExpectedIncomeInitial;
  projects: { id: string; display_name: string }[];
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = el.reports;
  return (
    <>
      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
        {trigger ?? `+ ${t.expectedAdd}`}
      </Button>
      {open && (
        <FormModal onClose={() => setOpen(false)} title={initial ? t.expectedEdit : t.expectedAdd} action={action}>
          <Field>
            <Label>{t.expectedSource}</Label>
            <Input name="source" defaultValue={initial?.source} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.expectedAmount} (€)</Label>
              <Input type="number" step="0.01" min="0" name="amount" defaultValue={initial?.amount} required />
            </Field>
            <Field>
              <Label>{t.expectedMonth}</Label>
              <Input type="month" name="expected_month" defaultValue={initial?.expected_month?.slice(0, 7) ?? ""} required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.probability} %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="5"
                name="probability_pct"
                defaultValue={initial?.probability != null ? Math.round(initial.probability * 100) : 50}
              />
            </Field>
            <Field>
              <Label>{t.scope}</Label>
              <Select name="owner_scope" defaultValue={initial?.owner_scope ?? "corporate"}>
                <option value="corporate">{el.account.ownerValues.corporate}</option>
                <option value="personal">{el.account.ownerValues.personal}</option>
              </Select>
            </Field>
          </div>
          <Field>
            <Label>{el.transaction.project}</Label>
            <Select name="project_id" defaultValue={initial?.project_id ?? ""}>
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>{el.netWorth.notes}</Label>
            <Input name="notes" defaultValue={initial?.notes ?? ""} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
