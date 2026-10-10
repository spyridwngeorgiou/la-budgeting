"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Badge, Button, Field, Input, Label, Select } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { DuplicateWarning } from "@/components/DuplicateWarning";
import { formatMoney } from "@/lib/format";
import { cashOnly, deriveFromNet } from "@/lib/finance/money";
import { VAT_RATES } from "@/lib/domain/enums";
import { el } from "@/lib/i18n/el";
import type { Extraction } from "@/lib/ai/schemas";
import type { DuplicateCandidate } from "@/lib/ingest/duplicates";
import { saveCaptureRow } from "../actions";
import { useReview } from "./ReviewContext";

// The old draft review (documents/[id]/review/ReviewForm.tsx), moved onto a
// staged ai_* row: document preview next to the fields, what the AI read
// (with its evidence) beside each value, the same validation server-side
// (saveCaptureRow). Saving makes the row «Νέα κίνηση»; the batch commit
// writes it, exactly once, through commit_ingest_batch.

export interface CaptureRowValues {
  direction: "income" | "expense" | null;
  tx_date: string | null;
  due_date: string | null;
  status: "paid" | "pending" | "scheduled" | "cancelled" | null;
  paid_on: string | null;
  scope: "business" | "personal";
  counterparty_name: string | null;
  counterparty_afm: string | null;
  contact_id: string | null;
  project_id: string | null;
  category_id: string | null;
  account_id: string | null;
  has_invoice: boolean | null;
  net_amount: number | null;
  vat_rate: number | null;
  withholding_amount: number | null;
  amount: number | null;
  invoice_number: string | null;
  mydata_mark: string | null;
  description: string | null;
}

const t = el.ingest.review;

function Evidence({ value, evidence }: { value?: string | number | null; evidence?: string | null }) {
  if (value == null && !evidence) return null;
  return (
    <span className="text-xs text-ai-ink" title={evidence ?? undefined}>
      ({t.aiRead}: {typeof value === "number" ? formatMoney(value) : (value ?? "—")}
      {evidence ? ` · ${t.evidence} «${evidence}»` : ""})
    </span>
  );
}

export function CaptureReview({
  rowId,
  rowNo,
  values,
  extraction,
  needsReview,
  documentUrl,
  documentMime,
}: {
  rowId: string;
  rowNo: number;
  values: CaptureRowValues;
  extraction: Extraction | null;
  needsReview: string[];
  documentUrl: string | null;
  documentMime: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
        {t.open}
      </Button>
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          title={`${t.editTitle} · ${el.ingest.row} ${rowNo}`}
          className="w-[calc(100%-2rem)] max-w-5xl rounded bg-white p-5"
          closeOnBackdrop={false}
        >
          <CaptureForm
            rowId={rowId}
            values={values}
            extraction={extraction}
            needsReview={needsReview}
            documentUrl={documentUrl}
            documentMime={documentMime}
            onDone={() => setOpen(false)}
          />
        </Modal>
      )}
    </>
  );
}

function CaptureForm({
  rowId,
  values,
  extraction: e,
  needsReview,
  documentUrl,
  documentMime,
  onDone,
}: {
  rowId: string;
  values: CaptureRowValues;
  extraction: Extraction | null;
  needsReview: string[];
  documentUrl: string | null;
  documentMime: string | null;
  onDone: () => void;
}) {
  const { batchId, lookups } = useReview();
  const [direction, setDirection] = useState<"expense" | "income">(values.direction ?? "expense");
  const [hasInvoice, setHasInvoice] = useState(values.has_invoice ?? false);
  const [netAmount, setNetAmount] = useState(String(values.net_amount ?? values.amount ?? 0));
  const [vatRate, setVatRate] = useState(String(values.vat_rate ?? 0.24));
  const [withholding, setWithholding] = useState(String(values.withholding_amount ?? 0));
  const [txDate, setTxDate] = useState(values.tx_date ?? "");
  const [txStatus, setTxStatus] = useState(values.status === "cancelled" || !values.status ? "pending" : values.status);
  // null = follow the document date until the user picks a payment date.
  const [paidOn, setPaidOn] = useState<string | null>(values.paid_on);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  // The submission the duplicate warning is about, resent as-is on confirm.
  const pendingRef = useRef<FormData | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = useMemo(() => {
    const net = Number(netAmount) || 0;
    return hasInvoice ? deriveFromNet(net, Number(vatRate) || 0, Number(withholding) || 0) : cashOnly(net);
  }, [netAmount, vatRate, withholding, hasInvoice]);

  function submit(formData: FormData) {
    setError(null);
    setDuplicates([]);
    startTransition(async () => {
      const result = await saveCaptureRow(batchId, rowId, formData);
      if ("error" in result) setError(result.error);
      else if ("duplicates" in result) {
        pendingRef.current = formData;
        setDuplicates(result.duplicates);
      } else onDone();
    });
  }

  const isPdf = documentMime === "application/pdf";

  return (
    <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto md:flex-row">
      {documentUrl && (
        <div className="flex flex-col gap-1 md:w-1/2">
          {isPdf ? (
            <iframe src={documentUrl} title={t.document} className="h-[70vh] w-full rounded-lg border border-line" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={documentUrl} alt={t.document} className="max-h-[45vh] w-full rounded-lg border border-line object-contain md:max-h-[70vh]" />
          )}
          <a href={documentUrl} target="_blank" rel="noreferrer" className="text-xs text-ink-muted underline">
            {t.openDocument}
          </a>
        </div>
      )}

      {/* onSubmit, not action={...}: React resets an action form's
          uncontrolled fields when the action returns, which would wipe the
          reviewer's edits while the duplicate warning is open. */}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          submit(new FormData(ev.currentTarget));
        }}
        className="flex flex-1 flex-col gap-3"
      >
        {needsReview.length > 0 && (
          <ul className="list-disc rounded-lg border border-amber-ink/40 bg-amber-bg p-3 pl-7 text-sm text-amber-ink">
            {needsReview.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {e?.notes_for_human && (
          <p className="text-xs text-ink-muted">
            {t.aiNote}: {e.notes_for_human}
          </p>
        )}

        <div className="flex gap-2">
          {(["expense", "income"] as const).map((d) => (
            <label
              key={d}
              className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm ${
                direction === d ? "border-ink bg-ink text-white" : "border-line-strong"
              }`}
            >
              <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} className="hidden" />
              {d === "expense" ? t.expense : t.income}
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <Label className="flex flex-wrap items-center gap-2">
              {t.date} <Evidence value={e?.issue_date} />
            </Label>
            <Input type="date" name="tx_date" value={txDate} onChange={(ev) => setTxDate(ev.target.value)} required />
          </Field>
          <Field>
            <Label>{el.transaction.dueDate}</Label>
            <Input type="date" name="due_date" defaultValue={values.due_date ?? ""} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <Label>{el.ingest.counterpartyName}</Label>
            <Input name="counterparty_name" defaultValue={values.counterparty_name ?? ""} />
          </Field>
          <Field>
            <Label className="flex flex-wrap items-center gap-2">
              {el.ingest.counterpartyAfm} <Evidence value={e?.issuer_afm} />
            </Label>
            <Input name="counterparty_afm" inputMode="numeric" defaultValue={values.counterparty_afm ?? ""} />
          </Field>
        </div>

        <Field>
          <Label className="flex flex-wrap items-center gap-2">
            {t.contact} <Evidence value={e?.issuer_name} />
          </Label>
          <Select name="contact_id" defaultValue={values.contact_id ?? ""} className={values.contact_id ? "" : "border-amber-ink/70"}>
            <option value="">—</option>
            {lookups.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          {!values.contact_id && <Badge tone="amber">{t.needsCheck}</Badge>}
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <Label className="flex flex-wrap items-center gap-2">
              {t.project} <Evidence value={e?.project_mention} />
            </Label>
            <Select name="project_id" defaultValue={values.project_id ?? ""} className={values.project_id ? "" : "border-amber-ink/70"}>
              <option value="">—</option>
              {lookups.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            {!values.project_id && <Badge tone="amber">{t.needsCheck}</Badge>}
          </Field>
          <Field>
            <Label className="flex flex-wrap items-center gap-2">
              {t.category} <Evidence value={e?.suggested_category} />
            </Label>
            <Select name="category_id" defaultValue={values.category_id ?? ""}>
              <option value="">—</option>
              {lookups.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field>
          <Label>{t.account}</Label>
          <Select name="account_id" defaultValue={values.account_id ?? ""} required>
            <option value="">—</option>
            {lookups.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="has_invoice" checked={hasInvoice} onChange={(ev) => setHasInvoice(ev.target.checked)} />
          {t.hasInvoice}
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field>
            <Label className="flex flex-wrap items-center gap-2">
              {t.net} <Evidence value={e?.net.value} evidence={e?.net.evidence} />
            </Label>
            <Input type="number" step="0.01" name="net_amount" value={netAmount} onChange={(ev) => setNetAmount(ev.target.value)} required />
          </Field>
          {hasInvoice && (
            <>
              <Field>
                <Label className="flex flex-wrap items-center gap-2">
                  {t.vatRate} <Evidence value={e?.vat.value} evidence={e?.vat.evidence} />
                </Label>
                <Select name="vat_rate" value={vatRate} onChange={(ev) => setVatRate(ev.target.value)}>
                  {VAT_RATES.map((r) => (
                    <option key={r} value={r}>
                      {(r * 100).toFixed(0)}%
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label className="flex flex-wrap items-center gap-2">
                  {t.withholding} <Evidence value={e?.withholding.value} evidence={e?.withholding.evidence} />
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  name="withholding_amount"
                  value={withholding}
                  onChange={(ev) => setWithholding(ev.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        <div className="rounded bg-bg p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              {t.total} <Evidence value={e?.gross.value} evidence={e?.gross.evidence} />
            </span>
            <span className="font-mono font-medium">{formatMoney(preview.gross)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <Label>{t.status}</Label>
            <Select name="status" value={txStatus} onChange={(ev) => setTxStatus(ev.target.value as typeof txStatus)}>
              {(["paid", "pending", "scheduled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t.statusValues[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>{el.ingest.scope}</Label>
            <Select name="scope" defaultValue={values.scope}>
              <option value="business">{el.ingest.scopeValues.business}</option>
              <option value="personal">{el.ingest.scopeValues.personal}</option>
            </Select>
          </Field>
        </div>

        {/* A paid row must carry its payment date (tx_paid_needs_date). */}
        {txStatus === "paid" && (
          <Field>
            <Label>{el.ingest.paidOn}</Label>
            <Input type="date" name="paid_on" value={paidOn ?? txDate} onChange={(ev) => setPaidOn(ev.target.value)} required />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <Label className="flex flex-wrap items-center gap-2">
              {t.invoiceNumber} <Evidence value={e?.invoice_number} />
            </Label>
            <Input name="invoice_number" defaultValue={values.invoice_number ?? ""} />
          </Field>
          <Field>
            <Label className="flex flex-wrap items-center gap-2">
              {el.ingest.mydataMark} <Evidence value={e?.mydata_mark} />
            </Label>
            <Input name="mydata_mark" inputMode="numeric" defaultValue={values.mydata_mark ?? ""} />
          </Field>
        </div>

        <Field>
          <Label>{t.description}</Label>
          <Input name="description" defaultValue={values.description ?? ""} />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-red-ink">
            {error}
          </p>
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
          <Button type="button" variant="secondary" onClick={onDone}>
            {el.common.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "…" : t.saveAndAccept}
          </Button>
        </div>
      </form>
    </div>
  );
}
