"use client";

import { useState } from "react";
import { Button, Input, Label, Field, Modal } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { errorOf } from "@/lib/actions";

interface Props {
  action: (formData: FormData) => Promise<unknown>;
  initial?: { name?: string; afm?: string | null; phone?: string | null; email?: string | null };
  trigger?: string;
}

export function ContactFormModal({ action, initial, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="max-md:min-h-11">
        {trigger ?? "+ Νέα Επαφή"}
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
              try {
                const message = errorOf(await action(formData));
                if (message) return setError(message);
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Σφάλμα");
              }
            }}
            className="flex flex-col gap-4"
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
            {error && (
              <p role="alert" className="border-l-2 border-negative pl-3 text-body text-negative">
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
