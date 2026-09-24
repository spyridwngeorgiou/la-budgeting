"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { PROJECT_STATUS, PROJECT_TYPE, BUSINESS_MODEL } from "@/lib/domain/enums";

interface Props {
  action: (formData: FormData) => Promise<void>;
  initial?: {
    code?: string;
    display_name?: string;
    project_type?: string | null;
    status?: string;
    business_model?: string | null;
    start_date?: string | null;
    contract_value?: number | null;
    contract_signed_date?: string | null;
  };
  trigger?: string;
}

export function ProjectFormModal({ action, initial, trigger }: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return <Button onClick={() => setOpen(true)}>{trigger ?? "+ Νέο Έργο"}</Button>;
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
            <Label>{el.project.code}</Label>
            <Input name="code" defaultValue={initial?.code} required readOnly={!!initial} className={initial ? "bg-bg text-ink-muted" : ""} />
          </Field>
          <Field>
            <Label>{el.project.name}</Label>
            <Input name="display_name" defaultValue={initial?.display_name} required />
          </Field>
          <Field>
            <Label>Τύπος Έργου</Label>
            <Select name="project_type" defaultValue={initial?.project_type ?? ""}>
              <option value="">—</option>
              {PROJECT_TYPE.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>{el.project.status}</Label>
            <Select name="status" defaultValue={initial?.status ?? "active"}>
              {PROJECT_STATUS.map((s) => (
                <option key={s} value={s}>
                  {el.project.statusValues[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>Μοντέλο</Label>
            <Select name="business_model" defaultValue={initial?.business_model ?? ""}>
              <option value="">—</option>
              {BUSINESS_MODEL.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>Ημ/νία Έναρξης</Label>
            <Input type="date" name="start_date" defaultValue={initial?.start_date ?? ""} />
          </Field>
          <Field>
            <Label>Συμβατική Αξία (€) — έργο πελάτη</Label>
            <Input type="number" step="0.01" name="contract_value" defaultValue={initial?.contract_value ?? ""} />
          </Field>
          <Field>
            <Label>Ημ/νία Υπογραφής Σύμβασης</Label>
            <Input type="date" name="contract_signed_date" defaultValue={initial?.contract_signed_date ?? ""} />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {el.common.cancel}
            </Button>
            <SubmitButton>{el.common.save}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
