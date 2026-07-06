"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import { CONTACT_KIND_LABEL, type Contact } from "@/lib/types";
import { createContact, updateContact } from "./actions";

export function ContactFormModal({ contact }: { contact?: Contact }) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(contact);

  return (
    <>
      {editing ? (
        <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
          <Pencil size={14} />
        </Button>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus size={16} /> Νέα επαφή
        </Button>
      )}

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Επεξεργασία επαφής" : "Νέα επαφή"}
      >
        <form
          action={editing ? updateContact : createContact}
          onSubmit={() => setOpen(false)}
          className="space-y-3"
        >
          {editing && <input type="hidden" name="id" value={contact!.id} />}
          <div>
            <Label>Όνομα</Label>
            <Input name="name" defaultValue={contact?.name} required />
          </div>
          <div>
            <Label>Τύπος</Label>
            <Select name="kind" defaultValue={contact?.kind ?? "vendor"}>
              {Object.entries(CONTACT_KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Σημειώσεις</Label>
            <Textarea name="notes" rows={2} defaultValue={contact?.notes ?? ""} />
          </div>
          <Button type="submit" className="w-full">
            {editing ? "Ενημέρωση" : "Αποθήκευση"}
          </Button>
        </form>
      </ModalShell>
    </>
  );
}
