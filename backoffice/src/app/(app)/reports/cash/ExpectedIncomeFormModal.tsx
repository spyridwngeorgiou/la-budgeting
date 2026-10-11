"use client";

import { useState } from "react";
import { Button, Field, FormDrawer, Input, Label, Select } from "@/components/ui";
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
  id = null,
  initial,
  projects,
  trigger,
}: {
  // The plain server action and the row id (null = new): no per-row .bind.
  action: (id: string | null, formData: FormData) => Promise<ActionResult>;
  id?: string | null;
  initial?: ExpectedIncomeInitial;
  projects: { id: string; display_name: string }[];
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = el.reports;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="present-hide print-hide">
        {trigger ?? `+ ${t.expectedAdd}`}
      </Button>
      {open && (
        <FormDrawer onClose={() => setOpen(false)} title={initial ? t.expectedEdit : t.expectedAdd} action={(formData: FormData) => action(id, formData)}>
          <Field>
            <Label>{t.expectedSource}</Label>
            <Input name="source" defaultValue={initial?.source} required />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label>{t.expectedAmount} (€)</Label>
              <Input type="number" step="0.01" min="0" name="amount" defaultValue={initial?.amount} required />
            </Field>
            <Field>
              <Label>{t.expectedMonth}</Label>
              <Input type="month" name="expected_month" defaultValue={initial?.expected_month?.slice(0, 7) ?? ""} required />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </FormDrawer>
      )}
    </>
  );
}
