"use client";

import { useState, useMemo } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { deriveFromNet, cashOnly } from "@/lib/finance/money";
import { formatMoney } from "@/lib/format";
import { VAT_RATES } from "@/lib/domain/enums";

interface Option {
  id: string;
  label: string;
}

export interface TransactionInitial {
  tx_date?: string;
  due_date?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  category_id?: string | null;
  account_id?: string | null;
  direction?: string;
  scope?: string;
  status?: string;
  net_amount?: number;
  vat_rate?: number | null;
  withholding_amount?: number;
  has_invoice?: boolean;
  description?: string | null;
  invoice_number?: string | null;
}

interface Props {
  action: (formData: FormData) => Promise<void>;
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
  initial?: TransactionInitial;
  onClose: () => void;
}

// A single controlled dialog -- NOT self-triggering. The caller (one shared
// instance per page, keyed by which row is being edited) owns whether it's
// open. Rendering one of these per table row was the real cause of the
// transactions page being slow: 102 rows each carrying their own copy of
// the full contacts/projects/categories/accounts option lists in the RSC
// payload, ~100x more serialized data than the page actually needed.
export function TransactionFormModal({
  action,
  contacts,
  projects,
  categories,
  accounts,
  initial,
  onClose,
}: Props) {
  const [direction, setDirection] = useState(initial?.direction ?? "expense");
  const [hasInvoice, setHasInvoice] = useState(initial?.has_invoice ?? false);
  const [netAmount, setNetAmount] = useState(initial?.net_amount?.toString() ?? "");
  const [vatRate, setVatRate] = useState(initial?.vat_rate?.toString() ?? "0.24");
  const [withholding, setWithholding] = useState(initial?.withholding_amount?.toString() ?? "0");

  const preview = useMemo(() => {
    const net = Number(netAmount) || 0;
    return hasInvoice
      ? deriveFromNet(net, Number(vatRate) || 0, Number(withholding) || 0)
      : cashOnly(net);
  }, [netAmount, vatRate, withholding, hasInvoice]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded bg-white p-5">
        <form
          action={async (formData) => {
            await action(formData);
            onClose();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex gap-2">
            {(["expense", "income"] as const).map((d) => (
              <label
                key={d}
                className={`flex-1 cursor-pointer rounded border px-3 py-2 text-center text-sm ${
                  direction === d ? "border-ink bg-ink text-white" : "border-line-strong"
                }`}
              >
                <input
                  type="radio"
                  name="direction"
                  value={d}
                  checked={direction === d}
                  onChange={() => setDirection(d)}
                  className="hidden"
                />
                {d === "expense" ? el.transaction.expense : el.transaction.income}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{el.transaction.date}</Label>
              <Input
                type="date"
                name="tx_date"
                defaultValue={initial?.tx_date ?? new Date().toISOString().slice(0, 10)}
                required
              />
            </Field>
            <Field>
              <Label>{el.transaction.dueDate}</Label>
              <Input type="date" name="due_date" defaultValue={initial?.due_date ?? ""} />
            </Field>
          </div>

          <Field>
            <Label>{el.transaction.contact}</Label>
            <Select name="contact_id" defaultValue={initial?.contact_id ?? ""}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{el.transaction.project}</Label>
              <Select name="project_id" defaultValue={initial?.project_id ?? ""}>
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>{el.transaction.category}</Label>
              <Select name="category_id" defaultValue={initial?.category_id ?? ""}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field>
            <Label>{el.transaction.account}</Label>
            <Select name="account_id" defaultValue={initial?.account_id ?? ""} required>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="has_invoice"
              checked={hasInvoice}
              onChange={(e) => setHasInvoice(e.target.checked)}
            />
            {el.transaction.hasInvoice}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{el.transaction.netAmount}</Label>
              <Input
                type="number"
                step="0.01"
                name="net_amount"
                value={netAmount}
                onChange={(e) => setNetAmount(e.target.value)}
                required
              />
            </Field>
            {hasInvoice && (
              <Field>
                <Label>ΦΠΑ %</Label>
                <Select name="vat_rate" value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
                  {VAT_RATES.map((r) => (
                    <option key={r} value={r}>
                      {(r * 100).toFixed(0)}%
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {hasInvoice && (
            <Field>
              <Label>{el.transaction.withholding}</Label>
              <Input
                type="number"
                step="0.01"
                name="withholding_amount"
                value={withholding}
                onChange={(e) => setWithholding(e.target.value)}
              />
            </Field>
          )}

          <div className="rounded bg-bg p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-muted">{el.transaction.grossAmount}</span>
              <span className="font-mono font-medium">{formatMoney(preview.gross)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>{el.transaction.status}</Label>
              <Select name="status" defaultValue={initial?.status ?? "pending"}>
                <option value="paid">{el.transaction.paid}</option>
                <option value="pending">{el.transaction.pending}</option>
                <option value="scheduled">{el.transaction.scheduled}</option>
                <option value="cancelled">{el.transaction.cancelled}</option>
              </Select>
            </Field>
            <Field>
              <Label>Πεδίο</Label>
              <Select name="scope" defaultValue={initial?.scope ?? "business"}>
                <option value="business">Επιχειρηματικό</option>
                <option value="personal">Προσωπικό</option>
              </Select>
            </Field>
          </div>

          <Field>
            <Label>{el.transaction.description}</Label>
            <Input name="description" defaultValue={initial?.description ?? ""} />
          </Field>

          <Field>
            <Label>{el.transaction.invoiceNumber}</Label>
            <Input name="invoice_number" defaultValue={initial?.invoice_number ?? ""} />
          </Field>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {el.common.cancel}
            </Button>
            <SubmitButton>{el.common.save}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
