"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import {
  TX_STATUS_LABEL,
  TX_TYPE_LABEL,
  type Transaction,
  type Project,
  type Account,
  type Category,
} from "@/lib/types";
import { createTransaction, updateTransaction } from "./actions";

export function TransactionFormModal({
  transaction,
  projects,
  accounts,
  categories,
}: {
  transaction?: Transaction;
  projects: Project[];
  accounts: Account[];
  categories: Category[];
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(transaction);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      {editing ? (
        <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
          <Pencil size={14} />
        </Button>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus size={16} /> Νέα κίνηση
        </Button>
      )}

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Επεξεργασία κίνησης" : "Νέα κίνηση"}
      >
        <form
          action={editing ? updateTransaction : createTransaction}
          onSubmit={() => setOpen(false)}
          className="space-y-3"
        >
          {editing && <input type="hidden" name="id" value={transaction!.id} />}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Τύπος</Label>
              <Select name="type" defaultValue={transaction?.type ?? "expense"}>
                {Object.entries(TX_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Ποσό (€)</Label>
              <Input
                name="amount"
                type="number"
                step="0.01"
                required
                defaultValue={transaction?.amount ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Κατάσταση</Label>
              <Select
                name="status"
                defaultValue={transaction?.status ?? "upcoming"}
              >
                {Object.entries(TX_STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Ημερομηνία</Label>
              <Input
                name="tx_date"
                type="date"
                defaultValue={transaction?.tx_date ?? today}
              />
            </div>
          </div>

          <div>
            <Label>Έργο</Label>
            <Select name="project_id" defaultValue={transaction?.project_id ?? ""}>
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
              <Label>Κατηγορία</Label>
              <Select
                name="category_id"
                defaultValue={transaction?.category_id ?? ""}
              >
                <option value="">— Καμία —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Λογαριασμός</Label>
              <Select
                name="account_id"
                defaultValue={transaction?.account_id ?? ""}
              >
                <option value="">— Κανένας —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label>Πηγή / Σημειώσεις</Label>
            <Input
              name="source"
              placeholder="π.χ. πηγή χρηματοδότησης"
              defaultValue={transaction?.source ?? ""}
            />
          </div>
          <div>
            <Textarea
              name="notes"
              rows={2}
              placeholder="Σημειώσεις (προαιρετικά)"
              defaultValue={transaction?.notes ?? ""}
            />
          </div>

          <Button type="submit" className="w-full">
            {editing ? "Ενημέρωση" : "Αποθήκευση"}
          </Button>
        </form>
      </ModalShell>
    </>
  );
}
