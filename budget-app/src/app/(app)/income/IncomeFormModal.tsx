"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import type { ExpectedIncome, Project } from "@/lib/types";
import { createIncome, updateIncome } from "./actions";

export function IncomeFormModal({
  income,
  projects,
}: {
  income?: ExpectedIncome;
  projects: Project[];
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(income);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      {editing ? (
        <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
          <Pencil size={14} />
        </Button>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus size={16} /> Νέο αναμενόμενο έσοδο
        </Button>
      )}

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Επεξεργασία εσόδου" : "Νέο αναμενόμενο έσοδο"}
      >
        <form
          action={editing ? updateIncome : createIncome}
          onSubmit={() => setOpen(false)}
          className="space-y-3"
        >
          {editing && <input type="hidden" name="id" value={income!.id} />}
          <div>
            <Label>Περιγραφή</Label>
            <Input
              name="label"
              placeholder="π.χ. Ενοίκιο δωματίου 1"
              defaultValue={income?.label}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ποσό (€)</Label>
              <Input
                name="amount"
                type="number"
                step="0.01"
                required
                defaultValue={income?.amount ?? ""}
              />
            </div>
            <div>
              <Label>Συχνότητα</Label>
              <Select
                name="recurrence"
                defaultValue={income?.recurrence ?? "monthly"}
              >
                <option value="monthly">Μηνιαίο</option>
                <option value="oneoff">Εφάπαξ</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Έργο</Label>
            <Select name="project_id" defaultValue={income?.project_id ?? ""}>
              <option value="">— Χωρίς έργο —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Έναρξη</Label>
              <Input
                name="start_date"
                type="date"
                defaultValue={income?.start_date ?? today}
              />
            </div>
            <div>
              <Label>Λήξη (προαιρετικό)</Label>
              <Input
                name="end_date"
                type="date"
                defaultValue={income?.end_date ?? ""}
              />
            </div>
          </div>
          <Button type="submit" className="w-full">
            {editing ? "Ενημέρωση" : "Αποθήκευση"}
          </Button>
        </form>
      </ModalShell>
    </>
  );
}
