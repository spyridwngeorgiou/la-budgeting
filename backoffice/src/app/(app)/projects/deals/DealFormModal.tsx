"use client";

import { useState } from "react";
import { Button, Field, Input, Label, Select } from "@/components/ui";
import { FormModal } from "@/components/Modal";
import { el } from "@/lib/i18n/el";
import { DEAL_STAGE, type DealStage } from "@/lib/domain/enums";
import type { ActionResult } from "@/lib/actions";

export interface DealInitial {
  property_label: string;
  price: number;
  commission_pct: number; // fraction
  commission_amount: number | null;
  stage: DealStage;
  expected_close_date: string | null;
  client_contact_id: string | null;
  project_id: string | null;
  notes: string | null;
}

export function DealFormModal({
  action,
  initial,
  contacts,
  projects,
  trigger,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  initial?: DealInitial;
  contacts: { id: string; name: string }[];
  projects: { id: string; display_name: string }[];
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = el.deals;
  return (
    <>
      <Button variant={initial ? "secondary" : "primary"} className={initial ? "!px-2 !py-1 text-xs" : undefined} onClick={() => setOpen(true)}>
        {trigger ?? `+ ${t.add}`}
      </Button>
      {open && (
        <FormModal onClose={() => setOpen(false)} title={initial ? t.edit : t.add} action={action}>
          <Field>
            <Label>{t.property}</Label>
            <Input name="property_label" defaultValue={initial?.property_label} required />
          </Field>
          <Field>
            <Label>{t.client}</Label>
            <Select name="client_contact_id" defaultValue={initial?.client_contact_id ?? ""}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.price} (€)</Label>
              <Input type="number" step="0.01" min="0" name="price" defaultValue={initial?.price} required />
            </Field>
            <Field>
              <Label>{t.commissionPct}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                name="commission_pct"
                defaultValue={initial ? Math.round(initial.commission_pct * 10000) / 100 : 2}
              />
            </Field>
          </div>
          <Field>
            <Label>{t.commissionOverride}</Label>
            <Input type="number" step="0.01" min="0" name="commission_amount" defaultValue={initial?.commission_amount ?? ""} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{t.stage}</Label>
              <Select name="stage" defaultValue={initial?.stage ?? "lead"}>
                {DEAL_STAGE.filter((s) => s !== "closed").map((s) => (
                  <option key={s} value={s}>
                    {t.stages[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>{t.expectedClose}</Label>
              <Input type="date" name="expected_close_date" defaultValue={initial?.expected_close_date ?? ""} />
            </Field>
          </div>
          <Field>
            <Label>{t.project}</Label>
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
            <Label>{t.notes}</Label>
            <Input name="notes" defaultValue={initial?.notes ?? ""} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
