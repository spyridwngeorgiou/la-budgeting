"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Checkbox, Drawer, Field, Input, KeyValue, MoneyInput, Select } from "@/components/ui";
import { DuplicateWarning } from "@/components/DuplicateWarning";
import { cashOnly, deriveFromNet } from "@/lib/finance/money";
import { formatMoney } from "@/lib/format";
import { todayAthens } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { money } from "@/lib/i18n/v2/money";
import { errorOf } from "@/lib/actions";
import { parseGreekNumber } from "@/lib/ingest/text";
import { VAT_RATES } from "@/lib/domain/enums";
import type { DuplicateCandidate } from "@/lib/ingest/duplicates";
import type { Tables } from "@/lib/db/types";
import type { Options as TxOptions } from "./data";
import { suggestForContact } from "@/app/(app)/transactions/actions";
import { payPart, saveTransaction } from "./actions";

// «Νέα κίνηση» / «Επεξεργασία» in a drawer. The money fields are derived
// again on the server (createTransaction / updateTransaction): the preview
// here uses the same lib/finance/money functions, only for display.

type Option = { id: string; label: string };
export type TxInitial = Pick<
  Tables<"transactions">,
  "tx_date" | "due_date" | "paid_on" | "contact_id" | "project_id" | "property_project_id" | "category_id" | "account_id" | "direction"
  | "scope" | "status" | "net_amount" | "vat_rate" | "withholding_amount" | "has_invoice" | "description" | "invoice_number"
>;

const t = el.transaction;
const two = "grid grid-cols-2 gap-3";
// «1.234,56» or «1234.56» as typed; the server reads plain numbers.
const amountOf = (s: string) => parseGreekNumber(s) ?? 0;
function normalizeAmounts(formData: FormData, names: string[]) {
  for (const name of names) {
    const raw = String(formData.get(name) ?? "");
    if (raw) formData.set(name, String(parseGreekNumber(raw) ?? raw));
  }
}

function Options({ items }: { items: Option[] }) {
  return (
    <>
      <option value="">—</option>
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </>
  );
}

function Footer({ formId, pending, onClose, label = el.common.save }: { formId: string; pending: boolean; onClose: () => void; label?: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose}>
        {el.common.cancel}
      </Button>
      <Button type="submit" form={formId} disabled={pending}>
        {pending ? "…" : label}
      </Button>
    </div>
  );
}

const Alert = ({ text }: { text: string | null }) =>
  text ? (
    <p role="alert" className="border-l-2 border-negative pl-3 text-sm text-negative">
      {text}
    </p>
  ) : null;

export function TxDrawer({ id, initial, options, closeHref }: { id: string | null; initial?: TxInitial; options: TxOptions; closeHref: string }) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });
  const formId = useId();
  const [direction, setDirection] = useState<string>(initial?.direction ?? "expense");
  const [hasInvoice, setHasInvoice] = useState(initial?.has_invoice ?? false);
  const [net, setNet] = useState(initial?.net_amount?.toString() ?? "");
  const [vatRate, setVatRate] = useState(initial?.vat_rate?.toString() ?? "0.24");
  const [withholding, setWithholding] = useState(initial?.withholding_amount?.toString() ?? "0");
  const [projectId, setProjectId] = useState(initial?.project_id ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "");
  const [suggested, setSuggested] = useState(false);
  const [status, setStatus] = useState<string>(initial?.status ?? "pending");
  const [scope, setScope] = useState<string>(initial?.scope ?? "business");
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [pending, start] = useTransition();
  const last = useRef<FormData | null>(null);

  const gross = useMemo(() => {
    const n = amountOf(net);
    return (hasInvoice ? deriveFromNet(n, Number(vatRate) || 0, amountOf(withholding)) : cashOnly(n)).gross;
  }, [net, vatRate, withholding, hasInvoice]);

  function submit(formData: FormData) {
    setError(null);
    setDuplicates([]);
    normalizeAmounts(formData, ["net_amount", "withholding_amount"]);
    start(async () => {
      const result = await saveTransaction(id, formData);
      if ("duplicates" in result) {
        last.current = formData;
        setDuplicates(result.duplicates);
      } else if (errorOf(result)) setError(errorOf(result));
      else close();
    });
  }

  // A new row: the contact's last transaction prefills project / category
  // (only the ones still empty). Never on an edit.
  async function onContact(contactId: string) {
    if (initial || !contactId) return;
    const prior = await suggestForContact(contactId);
    if (!prior) return;
    if (!projectId && prior.project_id) setProjectId(prior.project_id);
    if (!categoryId && prior.category_id) setCategoryId(prior.category_id);
    setSuggested(!!(prior.project_id || prior.category_id));
  }

  const ai = suggested && <Badge tone="ai">AI</Badge>;
  return (
    <Drawer
      onClose={close}
      closeOnBackdrop={false}
      title={id ? money.tx.editTitle : money.tx.newTitle}
      footer={<Footer formId={formId} pending={pending} onClose={close} />}
    >
      {/* onSubmit, not action: an action form resets its fields when it
          returns, which would wipe the entry behind a duplicate warning. */}
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="direction" value={direction} />
        <div role="group" aria-label={t.type} className="grid grid-cols-2">
          {(["expense", "income"] as const).map((d) => (
            <Button key={d} type="button" variant={direction === d ? "primary" : "secondary"} aria-pressed={direction === d} onClick={() => setDirection(d)}>
              {t[d]}
            </Button>
          ))}
        </div>
        <div className={two}>
          <Field label={t.date}>
            <Input type="date" name="tx_date" defaultValue={initial?.tx_date ?? todayAthens()} required />
          </Field>
          <Field label={t.dueDate}>
            <Input type="date" name="due_date" defaultValue={initial?.due_date ?? ""} />
          </Field>
        </div>
        <Field label={t.contact}>
          <Select name="contact_id" defaultValue={initial?.contact_id ?? ""} onChange={(e) => onContact(e.target.value)}>
            <Options items={options.contacts} />
          </Select>
        </Field>
        <div className={two}>
          <Field label={<span className="inline-flex gap-2">{t.project}{ai}</span>}>
            <Select name="project_id" value={projectId} onChange={(e) => (setProjectId(e.target.value), setSuggested(false))}>
              <Options items={options.projects} />
            </Select>
          </Field>
          <Field label={<span className="inline-flex gap-2">{t.category}{ai}</span>}>
            <Select name="category_id" value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setSuggested(false))}>
              <Options items={options.categories} />
            </Select>
          </Field>
        </div>
        <Field label={t.account}>
          <Select name="account_id" defaultValue={initial?.account_id ?? ""} required>
            <Options items={options.accounts} />
          </Select>
        </Field>
        <Checkbox name="has_invoice" label={t.hasInvoice} checked={hasInvoice} onChange={(e) => setHasInvoice(e.target.checked)} />
        <div className={two}>
          <Field label={t.netAmount}>
            <MoneyInput name="net_amount" value={net} onChange={(e) => setNet(e.target.value)} required />
          </Field>
          {hasInvoice && (
            <Field label={t.vat}>
              <Select name="vat_rate" value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
                {VAT_RATES.map((r) => (
                  <option key={r} value={r}>
                    {Math.round(r * 100)}%
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {hasInvoice && (
          <Field label={t.withholding}>
            <MoneyInput name="withholding_amount" value={withholding} onChange={(e) => setWithholding(e.target.value)} />
          </Field>
        )}
        <KeyValue items={[{ label: t.grossAmount, value: formatMoney(gross), numeric: true }]} />
        <div className={two}>
          <Field label={t.status}>
            <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {(["paid", "pending", "scheduled", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={money.tx.scopeLabel}>
            <Select name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="business">{money.tx.scope.business}</option>
              <option value="personal">{money.tx.scope.personal}</option>
            </Select>
          </Field>
        </div>
        {/* A paid row must carry its payment date (tx_paid_needs_date). */}
        {status === "paid" && (
          <Field label={money.tx.paidOn}>
            <Input type="date" name="paid_on" defaultValue={initial?.paid_on ?? todayAthens()} required />
          </Field>
        )}
        {scope === "personal" && (
          <Field label={money.tx.property}>
            <Select name="property_project_id" defaultValue={initial?.property_project_id ?? ""}>
              <Options items={options.projects} />
            </Select>
          </Field>
        )}
        <Field label={t.description}>
          <Input name="description" defaultValue={initial?.description ?? ""} />
        </Field>
        <Field label={t.invoiceNumber}>
          <Input name="invoice_number" defaultValue={initial?.invoice_number ?? ""} />
        </Field>
        <Alert text={error} />
        {duplicates.length > 0 && (
          <DuplicateWarning
            duplicates={duplicates}
            onCancel={() => setDuplicates([])}
            onConfirm={() => {
              if (!last.current) return;
              last.current.set("confirm_duplicate", "1");
              submit(last.current);
            }}
          />
        )}
      </form>
    </Drawer>
  );
}

// «Μερική πληρωμή» of an open one-off row (record_partial_payment, 0030).
export function PayDrawer({
  id,
  label,
  remaining,
  accountId,
  accounts,
  closeHref,
}: {
  id: string;
  label: string;
  remaining: number;
  accountId: string | null;
  accounts: Option[];
  closeHref: string;
}) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });
  const formId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const paid = amountOf(value);
  const left = Math.round((remaining - paid) * 100) / 100;
  return (
    <Drawer
      onClose={close}
      closeOnBackdrop={false}
      eyebrow={label}
      title={money.tx.payPartTitle}
      footer={<Footer formId={formId} pending={pending} onClose={close} label={money.tx.record} />}
    >
      <form
        id={formId}
        action={(formData) => {
          setError(null);
          formData.set("amount", String(paid));
          start(async () => {
            const message = errorOf(await payPart(id, formData));
            if (message) setError(message);
            else close();
          });
        }}
        className="flex flex-col gap-4"
      >
        <div className={two}>
          <Field label={money.tx.payAmount}>
            <MoneyInput name="amount_text" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
          </Field>
          <Field label={money.tx.paidOn}>
            <Input type="date" name="paid_on" defaultValue={todayAthens()} required />
          </Field>
        </div>
        <Field label={t.account}>
          <Select name="account_id" defaultValue={accountId ?? ""} required>
            <Options items={accounts} />
          </Select>
        </Field>
        <KeyValue
          items={[
            { label: money.tx.remaining, value: formatMoney(remaining), numeric: true },
            { label: t.paid, value: formatMoney(paid), numeric: true },
            { label: money.tx.staysOpen, value: formatMoney(Math.max(left, 0)), numeric: true },
          ]}
        />
        {paid > 0 && left === 0 && <p className="text-small text-muted">{money.tx.payWhole}</p>}
        {left < 0 && <Alert text={`${money.tx.remaining}: ${formatMoney(remaining)}`} />}
        <Alert text={error} />
      </form>
    </Drawer>
  );
}
