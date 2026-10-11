"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field, Modal } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { ACCOUNT_KIND, OWNER_SCOPE } from "@/lib/domain/enums";
import { todayAthens } from "@/lib/dates";
import { errorOf } from "@/lib/actions";

export function AccountFormModal({ action }: { action: (formData: FormData) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="max-md:min-h-11">
        + Νέος Λογαριασμός
      </Button>
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto border border-hairline bg-raised p-5 md:p-6"
          closeOnBackdrop={false}
        >
          <form
            action={async (formData) => {
              setError(null);
              const message = errorOf(await action(formData));
              if (message) return setError(message);
              setOpen(false);
            }}
            className="flex flex-col gap-4"
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
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start text-sm text-ink md:min-h-10">
              <input type="checkbox" name="is_liquid" defaultChecked className="h-4 w-4 accent-navy" />
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
                defaultValue={todayAthens()}
                required
              />
            </Field>
            {error && (
              <p role="alert" className="border-l-2 border-negative pl-3 text-sm text-negative">
                {error}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {el.common.cancel}
              </Button>
              <SubmitButton>{el.common.save}</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
