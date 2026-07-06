"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import { formatEuro } from "@/lib/utils";
import {
  TX_STATUS_LABEL,
  TX_TYPE_LABEL,
  VAT_STATUS_LABEL,
  type Transaction,
  type Project,
  type Account,
  type Category,
  type Contact,
} from "@/lib/types";
import { createTransaction, updateTransaction } from "./actions";

export function TransactionFormModal({
  transaction,
  projects,
  accounts,
  categories,
  contacts,
}: {
  transaction?: Transaction;
  projects: Project[];
  accounts: Account[];
  categories: Category[];
  contacts: Contact[];
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(transaction);
  const today = new Date().toISOString().slice(0, 10);

  const [net, setNet] = useState<number>(
    transaction ? Number(transaction.net_amount ?? transaction.amount) || 0 : 0,
  );
  const [vat, setVat] = useState<number>(
    transaction ? Number(transaction.vat_amount) || 0 : 0,
  );
  const [withholding, setWithholding] = useState<number>(
    transaction ? Number(transaction.withholding_amount) || 0 : 0,
  );
  const total = Math.round((net + vat - withholding) * 100) / 100;

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
          </div>

          {/* Ανάλυση ποσού */}
          <div className="rounded-lg border border-border bg-slate-50 p-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Καθαρή αξία (€)</Label>
                <Input
                  name="net_amount"
                  type="number"
                  step="0.01"
                  required
                  value={net || ""}
                  onChange={(e) => setNet(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>ΦΠΑ (€)</Label>
                <Input
                  name="vat_amount"
                  type="number"
                  step="0.01"
                  value={vat || ""}
                  onChange={(e) => setVat(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Παρακράτηση (€)</Label>
                <Input
                  name="withholding_amount"
                  type="number"
                  step="0.01"
                  value={withholding || ""}
                  onChange={(e) =>
                    setWithholding(Number(e.target.value) || 0)
                  }
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="w-40">
                <Label>Κατάσταση ΦΠΑ</Label>
                <Select
                  name="vat_status"
                  defaultValue={transaction?.vat_status ?? "none"}
                >
                  {Object.entries(VAT_STATUS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">Τελικό ποσό</p>
                <p className="text-lg font-bold text-primary">
                  {formatEuro(total)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Επαφή</Label>
              <Select
                name="contact_id"
                defaultValue={transaction?.contact_id ?? ""}
              >
                <option value="">— Καμία —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Έργο</Label>
              <Select
                name="project_id"
                defaultValue={transaction?.project_id ?? ""}
              >
                <option value="">— Χωρίς έργο —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label>Ημερομηνία</Label>
              <Input
                name="tx_date"
                type="date"
                defaultValue={transaction?.tx_date ?? today}
              />
            </div>
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
              <Label>Πηγή</Label>
              <Input
                name="source"
                placeholder="π.χ. τρόπος πληρωμής"
                defaultValue={transaction?.source ?? ""}
              />
            </div>
          </div>

          <div>
            <Label>Περιγραφή</Label>
            <Textarea
              name="notes"
              rows={2}
              placeholder="π.χ. Προκαταβολή αγοράς"
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
