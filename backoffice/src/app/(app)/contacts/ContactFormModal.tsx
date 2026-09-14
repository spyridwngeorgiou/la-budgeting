"use client";

import { useState } from "react";
import { Button, Input, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";

interface Props {
  action: (formData: FormData) => Promise<void>;
  initial?: { name?: string; afm?: string | null; phone?: string | null; email?: string | null };
  trigger?: string;
}

export function ContactFormModal({ action, initial, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <Button onClick={() => setOpen(true)}>{trigger ?? "+ Νέα Επαφή"}</Button>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded bg-white p-5">
        <form
          action={async (formData) => {
            setError(null);
            try {
              await action(formData);
              setOpen(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Σφάλμα");
            }
          }}
          className="flex flex-col gap-3"
        >
          <Field>
            <Label>{el.contact.name}</Label>
            <Input name="name" defaultValue={initial?.name} required />
          </Field>
          <Field>
            <Label>{el.contact.afm}</Label>
            <Input name="afm" defaultValue={initial?.afm ?? ""} pattern="[0-9]{9}" maxLength={9} />
          </Field>
          <Field>
            <Label>{el.contact.phone}</Label>
            <Input name="phone" defaultValue={initial?.phone ?? ""} />
          </Field>
          <Field>
            <Label>{el.contact.email}</Label>
            <Input type="email" name="email" defaultValue={initial?.email ?? ""} />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
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
