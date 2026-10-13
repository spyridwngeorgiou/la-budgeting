"use client";

import { useId, useState } from "react";
import { Button, Field, FormDrawer, Input, useToast, type ButtonVariant } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { createContact, updateContact } from "./actions";

export interface ContactValues {
  id: string;
  name: string;
  afm: string | null;
  phone: string | null;
  email: string | null;
}

const c = el.contact;

// A contact's fields in the side drawer: «Νέα επαφή», or «Επεξεργασία
// επαφής» with `contact`. The actions are imported here and called with the
// id (never bound per row on the server); a refused ΑΦΜ shows above the
// buttons and the drawer stays open, a save says so in a toast.
export function ContactFormDrawer({ contact, onClose }: { contact?: ContactValues | null; onClose: () => void }) {
  const { show } = useToast();
  const id = useId();
  return (
    <FormDrawer
      onClose={onClose}
      eyebrow={el.nav.contacts}
      title={contact ? c.editTitle : c.addTitle}
      action={(formData) => (contact ? updateContact(contact.id, formData) : createContact(formData))}
      onSuccess={() => show(c.saved)}
    >
      <Field label={c.name} htmlFor={`${id}-name`} required>
        <Input id={`${id}-name`} name="name" defaultValue={contact?.name ?? ""} required />
      </Field>
      <Field label={c.afm} htmlFor={`${id}-afm`} hint={c.afmHint}>
        <Input id={`${id}-afm`} name="afm" defaultValue={contact?.afm ?? ""} inputMode="numeric" pattern="[0-9]{9}" maxLength={9} />
      </Field>
      <Field label={c.phone} htmlFor={`${id}-phone`}>
        <Input id={`${id}-phone`} type="tel" name="phone" defaultValue={contact?.phone ?? ""} />
      </Field>
      <Field label={c.email} htmlFor={`${id}-email`}>
        <Input id={`${id}-email`} type="email" name="email" defaultValue={contact?.email ?? ""} />
      </Field>
    </FormDrawer>
  );
}

// The button that opens it: «+ Νέα επαφή» in the list's header,
// «Επεξεργασία» in a contact's.
export function ContactFormButton({
  contact,
  label,
  variant = "primary",
}: {
  contact?: ContactValues | null;
  label: string;
  variant?: ButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <ContactFormDrawer contact={contact} onClose={() => setOpen(false)} />}
    </>
  );
}
