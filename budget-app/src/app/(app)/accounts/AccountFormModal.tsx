"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import { ACCOUNT_TYPE_LABEL, type Account, type Project } from "@/lib/types";
import { createAccount, updateAccount } from "./actions";

export function AccountFormModal({
  account,
  projects,
}: {
  account?: Account;
  projects: Project[];
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(account);

  return (
    <>
      {editing ? (
        <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
          <Pencil size={14} />
        </Button>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus size={16} /> Νέος λογαριασμός
        </Button>
      )}

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Επεξεργασία λογαριασμού" : "Νέος λογαριασμός"}
      >
        <form
          action={editing ? updateAccount : createAccount}
          onSubmit={() => setOpen(false)}
          className="space-y-4"
        >
          {editing && <input type="hidden" name="id" value={account!.id} />}
          <div>
            <Label>Όνομα</Label>
            <Input name="name" defaultValue={account?.name} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Τύπος</Label>
              <Select name="type" defaultValue={account?.type ?? "bank"}>
                {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Ποσό (€)</Label>
              <Input
                name="balance"
                type="number"
                step="0.01"
                defaultValue={account?.balance ?? 0}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_incoming"
              defaultChecked={account?.is_incoming ?? false}
              className="h-4 w-4"
            />
            Αναμενόμενο έσοδο (δεν είναι ακόμη διαθέσιμο)
          </label>
          <div>
            <Label>Δέσμευση σε έργο (προαιρετικό)</Label>
            <Select name="project_id" defaultValue={account?.project_id ?? ""}>
              <option value="">— Γενικό (όλα τα έργα) —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted">
              Αν δεσμευτεί σε έργο (π.χ. δάνειο), δεν μετράει στα γενικά σύνολα —
              φαίνεται μόνο στο έργο.
            </p>
          </div>
          <Button type="submit" className="w-full">
            {editing ? "Ενημέρωση" : "Αποθήκευση"}
          </Button>
        </form>
      </ModalShell>
    </>
  );
}
