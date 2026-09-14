"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { ACCOUNT_KIND, OWNER_SCOPE } from "@/lib/domain/enums";

export function AccountFormModal({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Νέος Λογαριασμός</Button>;
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
          <Field>
            <Label>{el.account.name}</Label>
            <Input name="name" required />
          </Field>
          <Field>
            <Label>{el.account.kind}</Label>
            <Select name="kind" defaultValue="bank">
              {ACCOUNT_KIND.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>{el.account.ownerScope}</Label>
            <Select name="owner_scope" defaultValue="corporate">
              {OWNER_SCOPE.map((o) => (
                <option key={o} value={o}>
                  {el.account.ownerValues[o]}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_liquid" defaultChecked />
            Ρευστό διαθέσιμο
          </label>
          <Field>
            <Label>{el.account.openingBalance}</Label>
            <Input type="number" step="0.01" name="opening_balance" defaultValue="0" />
          </Field>
          <Field>
            <Label>Ημ/νία Υπολοίπου Έναρξης</Label>
            <Input
              type="date"
              name="opening_balance_date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
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
