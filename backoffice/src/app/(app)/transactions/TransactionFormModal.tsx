"use client";

import { useState, useMemo, useRef, useTransition } from "react";
import { Button, Input, Select, Label, Field, Badge, Modal, Notice } from "@/components/ui";
import { DuplicateWarning } from "@/components/DuplicateWarning";
import { el } from "@/lib/i18n/el";
import { deriveFromNet, cashOnly } from "@/lib/finance/money";
import { formatMoney, formatPercent } from "@/lib/format";
import { VAT_RATES } from "@/lib/domain/enums";
import type { DuplicateCandidate, WriteResult } from "@/lib/ingest/duplicates";
import { suggestForContact } from "./actions";
import { todayAthens } from "@/lib/dates";

// P15 dialog: raised panel, hairline frame, square, no shadow; scrolls
// inside itself on a short screen.
const MODAL = "max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border border-hairline bg-raised p-5 md:p-6";

interface Option {
  id: string;
  label: string;
}

export interface TransactionInitial {
  tx_date?: string;
  due_date?: string | null;
  paid_on?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  property_project_id?: string | null;
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
  action: (formData: FormData) => Promise<WriteResult>;
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
  const [projectId, setProjectId] = useState(initial?.project_id ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "");
  const [suggested, setSuggested] = useState(false);
  const [status, setStatus] = useState(initial?.status ?? "pending");
  const [scope, setScope] = useState(initial?.scope ?? "business");
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [pending, startTransition] = useTransition();
  // The submission the duplicate warning is about, resent as-is on confirm.
  const pendingRef = useRef<FormData | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setDuplicates([]);
    startTransition(async () => {
      const result = await action(formData);
      if ("error" in result) setError(result.error);
      else if ("duplicates" in result) {
        pendingRef.current = formData;
        setDuplicates(result.duplicates);
      } else onClose();
    });
  }

  // "Learn from history": picking a contact on a brand-new transaction (never
  // on an edit -- initial is only set when editing, and an existing row's
  // own values must never be silently overwritten) prefills project/category
  // from that contact's most recent transaction, the same way a human would
  // reach for "what did we do last time". Only fills fields still empty, so
  // it never clobbers something the user already picked.
  async function handleContactChange(contactId: string) {
    if (initial || !contactId) return;
    const last = await suggestForContact(contactId);
    if (!last) return;
    let applied = false;
    if (!projectId && last.project_id) {
      setProjectId(last.project_id);
      applied = true;
    }
    if (!categoryId && last.category_id) {
      setCategoryId(last.category_id);
      applied = true;
    }
    if (applied) setSuggested(true);
  }

  const preview = useMemo(() => {
    const net = Number(netAmount) || 0;
    return hasInvoice
      ? deriveFromNet(net, Number(vatRate) || 0, Number(withholding) || 0)
      : cashOnly(net);
  }, [netAmount, vatRate, withholding, hasInvoice]);

  return (
    <Modal onClose={onClose} className={MODAL} closeOnBackdrop={false}>
      {/* onSubmit, not action={...}: React resets an action form's
          uncontrolled fields when the action returns, which would wipe
          what was typed while the duplicate warning is open. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex">
          {(["expense", "income"] as const).map((d, i) => (
            <label
              key={d}
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center border px-3 py-2 text-center text-body transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy md:min-h-10 ${
                i > 0 ? "-ml-px" : ""
              } ${direction === d ? "border-navy bg-navy text-panel-ink" : "border-chip-border text-text hover:border-navy hover:text-ink"}`}
            >
              <input
                type="radio"
                name="direction"
                value={d}
                checked={direction === d}
                onChange={() => setDirection(d)}
                className="sr-only"
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
              defaultValue={initial?.tx_date ?? todayAthens()}
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
          <Select
            name="contact_id"
            defaultValue={initial?.contact_id ?? ""}
            onChange={(e) => handleContactChange(e.target.value)}
          >
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
            <Label className="flex items-center gap-2">
              {el.transaction.project}
              {suggested && <Badge tone="ai">AI πρόταση</Badge>}
            </Label>
            <Select
              name="project_id"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSuggested(false);
              }}
            >
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label className="flex items-center gap-2">
              {el.transaction.category}
              {suggested && <Badge tone="ai">AI πρόταση</Badge>}
            </Label>
            <Select
              name="category_id"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setSuggested(false);
              }}
            >
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

        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start text-body text-ink md:min-h-10">
          <input
            className="h-4 w-4 accent-navy"
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
                    {formatPercent(r, { digits: 0 })}
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

        <div className="border-y border-hairline py-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="eyebrow text-muted">{el.transaction.grossAmount}</span>
            <span className="num text-figure-sm font-light text-ink">{formatMoney(preview.gross)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <Label>{el.transaction.status}</Label>
            <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="paid">{el.transaction.paid}</option>
              <option value="pending">{el.transaction.pending}</option>
              <option value="scheduled">{el.transaction.scheduled}</option>
              <option value="cancelled">{el.transaction.cancelled}</option>
            </Select>
          </Field>
          <Field>
            <Label>Πεδίο</Label>
            <Select name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="business">Επιχειρηματικό</option>
              <option value="personal">Προσωπικό</option>
            </Select>
          </Field>
        </div>

        {/* A paid row must carry its payment date (DB constraint tx_paid_needs_date);
            editing a paid row without this field used to blank it and fail. */}
        {status === "paid" && (
          <Field>
            <Label>Ημ/νία πληρωμής</Label>
            <Input
              type="date"
              name="paid_on"
              defaultValue={initial?.paid_on ?? todayAthens()}
              required
            />
          </Field>
        )}

        {scope === "personal" && (
          <Field>
            <Label>Ακίνητο</Label>
            <Select name="property_project_id" defaultValue={initial?.property_project_id ?? ""}>
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field>
          <Label>{el.transaction.description}</Label>
          <Input name="description" defaultValue={initial?.description ?? ""} />
        </Field>

        <Field>
          <Label>{el.transaction.invoiceNumber}</Label>
          <Input name="invoice_number" defaultValue={initial?.invoice_number ?? ""} />
        </Field>

        {error && (
          <Notice tone="negative" role="alert">
            {error}
          </Notice>
        )}

        {duplicates.length > 0 && (
          <DuplicateWarning
            duplicates={duplicates}
            onCancel={() => setDuplicates([])}
            onConfirm={() => {
              const confirmed = pendingRef.current;
              if (!confirmed) return;
              confirmed.set("confirm_duplicate", "1");
              submit(confirmed);
            }}
          />
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {el.common.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "…" : el.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
