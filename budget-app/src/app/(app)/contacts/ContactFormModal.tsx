"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import {
  CONTACT_KIND_LABEL,
  CONTACT_TYPE_LABEL,
  type Contact,
} from "@/lib/types";
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
            <Label>Ρόλος συνεργασίας</Label>
            <Select
              name="contact_type"
              defaultValue={contact?.contact_type ?? "supplier"}
            >
              {Object.entries(CONTACT_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>ΑΦΜ</Label>
              <Input name="vat_number" defaultValue={contact?.vat_number ?? ""} />
            </div>
            <div>
              <Label>Όροι πληρωμής (ημέρες)</Label>
              <Input
                name="payment_terms_days"
                type="number"
                min="0"
                max="365"
                defaultValue={contact?.payment_terms_days ?? ""}
              />
            </div>
          </div>
          <div>
            <Label>IBAN</Label>
            <Input name="iban" defaultValue={contact?.iban ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Default ΦΠΑ (%)</Label>
              <Input
                name="default_vat_rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                defaultValue={contact?.default_vat_rate ?? ""}
              />
            </div>
            <div>
              <Label>Default παρακράτηση (%)</Label>
              <Input
                name="default_withholding_rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                defaultValue={contact?.default_withholding_rate ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input name="email" type="email" defaultValue={contact?.email ?? ""} />
            </div>
            <div>
              <Label>Τηλέφωνο</Label>
              <Input name="phone" defaultValue={contact?.phone ?? ""} />
            </div>
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
