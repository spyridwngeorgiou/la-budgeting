"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import { formatEuro } from "@/lib/utils";
import {
  TX_ACTIVE_STATUS_LABEL,
  TX_TYPE_LABEL,
  VAT_STATUS_LABEL,
  normalizeTxStatus,
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
  const [selectedProjectId, setSelectedProjectId] = useState<string>(transaction?.project_id ?? "");
  const [selectedAccountId, setSelectedAccountId] = useState<string>(transaction?.account_id ?? "");

  const [net, setNet] = useState<number>(
    transaction ? Number(transaction.net_amount ?? transaction.amount) || 0 : 0,
  );
  const [hasInvoice, setHasInvoice] = useState<boolean>(
    transaction ? Boolean(transaction.has_invoice) : false,
  );
  const [vatRate, setVatRate] = useState<number>(
    transaction ? Number(transaction.vat_rate) || 0 : 0,
  );
  const [vat, setVat] = useState<number>(
    transaction ? Number(transaction.vat_amount) || 0 : 0,
  );
  const [withholding, setWithholding] = useState<number>(
    transaction ? Number(transaction.withholding_amount) || 0 : 0,
  );
  const total = Math.round(
    (net + (hasInvoice ? vat : 0) - (hasInvoice ? withholding : 0)) * 100,
  ) / 100;

  const round2 = (x: number) => Math.round(x * 100) / 100;

  const applyNet = (value: number) => {
    setNet(value);
    if (vatRate > 0) setVat(round2((value * vatRate) / 100));
  };

  const applyRate = (rate: number) => {
    setVatRate(rate);
    setVat(rate > 0 ? round2((net * rate) / 100) : 0);
  };

  const onAccountChange = (accountId: string) => {
    setSelectedAccountId(accountId);
    const acc = accounts.find((a) => a.id === accountId);
    // Cash payments usually have no invoice / VAT — auto-simplify the form.
    if (!editing && acc?.type === "cash") setHasInvoice(false);
  };

  const allowedAccounts = useMemo(() => {
    if (!selectedProjectId) return accounts.filter((a) => !a.project_id);
    return accounts.filter((a) => !a.project_id || a.project_id === selectedProjectId);
  }, [accounts, selectedProjectId]);

  const safeSelectedAccountId = allowedAccounts.some((a) => a.id === selectedAccountId)
    ? selectedAccountId
    : "";

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
                defaultValue={normalizeTxStatus(transaction?.status ?? "upcoming")}
              >
                {Object.entries(TX_ACTIVE_STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Ανάλυση ποσού */}
          <div className="rounded-lg border border-border bg-slate-50 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>
                  {hasInvoice ? "Καθαρή αξία (€)" : "Ποσό (€)"}
                </Label>
                <Input
                  name="net_amount"
                  type="number"
                  step="0.01"
                  required
                  value={net || ""}
                  onChange={(e) => applyNet(Number(e.target.value) || 0)}
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="has_invoice"
                    checked={hasInvoice}
                    onChange={(e) => setHasInvoice(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Με παραστατικό (ΦΠΑ)
                </label>
              </div>
            </div>

            {hasInvoice && (
              <>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Ποσοστό ΦΠΑ</Label>
                    <Select
                      name="vat_rate"
                      value={String(vatRate)}
                      onChange={(e) => applyRate(Number(e.target.value) || 0)}
                    >
                      <option value="0">Χωρίς ΦΠΑ (0%)</option>
                      <option value="6">6%</option>
                      <option value="13">13%</option>
                      <option value="24">24%</option>
                    </Select>
                  </div>
                  <div>
                    <Label>ΦΠΑ (€) — επεξεργάσιμο</Label>
                    <Input
                      name="vat_amount"
                      type="number"
                      step="0.01"
                      value={vat || ""}
                      onChange={(e) => setVat(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
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
                  <div>
                    <Label>Κατάσταση ΦΠΑ</Label>
                    <Select
                      name="vat_status"
                      defaultValue={transaction?.vat_status ?? "payable"}
                    >
                      {Object.entries(VAT_STATUS_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </>
            )}

            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-muted">
                {hasInvoice
                  ? "Τελικό = Καθαρή + ΦΠΑ − Παρακράτηση"
                  : "Χωρίς παραστατικό (π.χ. μετρητά) — χωρίς ΦΠΑ"}
              </p>
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
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
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
                value={safeSelectedAccountId}
                onChange={(e) => onAccountChange(e.target.value)}
              >
                <option value="">— Γενικό σύνολο (κοινό) —</option>
                {allowedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-muted">
                Οι δεσμευμένοι λογαριασμοί (π.χ. δάνειο ΤΕΠΙΧ) εμφανίζονται μόνο στο αντίστοιχο έργο.
              </p>
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
