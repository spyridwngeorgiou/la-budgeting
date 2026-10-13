"use client";

import { useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Badge, Button, Checkbox, Drawer, Field, Input, MoneyInput, Notice, Select, useToast } from "@/components/ui";
import { DuplicateWarning } from "@/components/DuplicateWarning";
import { el } from "@/lib/i18n/el";
import { deriveFromNet, cashOnly } from "@/lib/finance/money";
import { formatMoney, formatPercent } from "@/lib/format";
import { VAT_RATES } from "@/lib/domain/enums";
import type { DuplicateCandidate, WriteResult } from "@/lib/ingest/duplicates";
import { amountInputValue, parseAmountInput } from "@/lib/amountInput";
import { suggestForContact } from "./actions";
import { todayAthens } from "@/lib/dates";

const t = el.transaction;

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
  // Above the title when editing: which movement.
  eyebrow?: string;
  onClose: () => void;
}

// One of the form's three titled groups.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="eyebrow w-full border-b border-hairline pb-2 text-muted">{title}</legend>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </fieldset>
  );
}

// Keeps a message the form just raised (an error, the duplicate warning) in
// sight when Save was pressed from the drawer's sticky footer.
const intoView = (node: HTMLElement | null) => node?.scrollIntoView({ block: "nearest" });

// «Νέα κίνηση» / «Επεξεργασία κίνησης» in the side drawer: Βασικά ·
// Αντιστοίχιση · Παραστατικό και λοιπά. A single controlled drawer -- NOT
// self-triggering: the caller (one shared instance per page, keyed by the
// row being edited) owns whether it is open. One per table row was what
// once made the page slow (every row carrying the full option lists).
//
// Its own onSubmit, not FormDrawer's form action: React resets an action
// form's uncontrolled fields when the action returns, which would wipe what
// was typed while the «Πιθανό διπλότυπο» warning is open -- and a duplicates
// answer must keep the drawer open. The look is FormDrawer's.
export function TransactionFormModal({ action, contacts, projects, categories, accounts, initial, eyebrow, onClose }: Props) {
  const [direction, setDirection] = useState(initial?.direction ?? "expense");
  const [hasInvoice, setHasInvoice] = useState(initial?.has_invoice ?? false);
  const [netAmount, setNetAmount] = useState(amountInputValue(initial?.net_amount));
  const [vatRate, setVatRate] = useState(initial?.vat_rate?.toString() ?? "0.24");
  const [withholding, setWithholding] = useState(amountInputValue(initial?.withholding_amount ?? 0));
  const [projectId, setProjectId] = useState(initial?.project_id ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "");
  const [suggested, setSuggested] = useState(false);
  const [status, setStatus] = useState(initial?.status ?? "pending");
  const [scope, setScope] = useState(initial?.scope ?? "business");
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [pending, startTransition] = useTransition();
  // The submission the duplicate warning is about, resent as-is on confirm.
  const pendingRef = useRef<FormData | null>(null);
  const { show } = useToast();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  const net = parseAmountInput(netAmount);
  const wh = hasInvoice ? parseAmountInput(withholding.trim() === "" ? "0" : withholding) : 0;

  function submit(formData: FormData) {
    setError(null);
    setDuplicates([]);
    setChecked(true);
    if (net === null || wh === null) return;
    startTransition(async () => {
      try {
        const result = await action(formData);
        if ("error" in result) setError(result.error);
        else if ("duplicates" in result) {
          pendingRef.current = formData;
          setDuplicates(result.duplicates);
        } else {
          show(el.common.saved);
          onClose();
        }
      } catch {
        setError(el.common.error);
      }
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

  const preview = useMemo(
    () => (hasInvoice ? deriveFromNet(net ?? 0, Number(vatRate) || 0, wh ?? 0) : cashOnly(net ?? 0)),
    [net, vatRate, wh, hasInvoice],
  );

  const aiBadge = suggested && (
    <Badge tone="ai" className="ml-2">
      {t.aiSuggestion}
    </Badge>
  );

  return (
    <Drawer onClose={onClose} title={initial ? t.editTitle : t.newTitle} eyebrow={eyebrow} closeOnBackdrop={false}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-6"
      >
        <Group title={t.groups.basics}>
          <div className="flex flex-col">
            <span id={id("type")} className="mb-1 block text-small font-medium text-muted">
              {t.type}
            </span>
            <div role="radiogroup" aria-labelledby={id("type")} className="flex">
              {(["expense", "income"] as const).map((d, i) => (
                <label
                  key={d}
                  className={`flex min-h-10 flex-1 cursor-pointer items-center justify-center border px-3 py-2 text-center text-body transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy pointer-coarse:min-h-11 ${
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
                  {d === "expense" ? t.expense : t.income}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t.date} htmlFor={id("date")} required>
              <Input id={id("date")} type="date" name="tx_date" defaultValue={initial?.tx_date ?? todayAthens()} required />
            </Field>
            <Field label={t.dueDate} htmlFor={id("due")}>
              <Input id={id("due")} type="date" name="due_date" defaultValue={initial?.due_date ?? ""} />
            </Field>
          </div>

          <Checkbox
            label={t.hasInvoice}
            name="has_invoice"
            checked={hasInvoice}
            onChange={(e) => setHasInvoice(e.target.checked)}
            className="self-start pointer-coarse:min-h-11"
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label={t.netAmount} htmlFor={id("net")} required error={checked && net === null ? t.invalidAmount : undefined}>
              <MoneyInput
                id={id("net")}
                name="net_amount"
                value={netAmount}
                onChange={(e) => setNetAmount(e.target.value)}
                aria-invalid={checked && net === null ? true : undefined}
                required
                className="w-full"
              />
            </Field>
            {hasInvoice && (
              <Field label={`${t.vat} %`} htmlFor={id("vat")}>
                <Select id={id("vat")} name="vat_rate" value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
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
            <Field label={t.withholding} htmlFor={id("wh")} error={checked && wh === null ? t.invalidAmount : undefined}>
              <MoneyInput
                id={id("wh")}
                name="withholding_amount"
                value={withholding}
                onChange={(e) => setWithholding(e.target.value)}
                aria-invalid={checked && wh === null ? true : undefined}
                className="w-full"
              />
            </Field>
          )}

          <div className="flex items-baseline justify-between gap-4 border-y border-hairline py-3">
            <span className="eyebrow text-muted">{t.grossAmount}</span>
            <span className="num text-figure-sm font-light text-ink">{formatMoney(preview.gross)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t.status} htmlFor={id("status")}>
              <Select id={id("status")} name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="paid">{t.paid}</option>
                <option value="pending">{t.pending}</option>
                <option value="scheduled">{t.scheduled}</option>
                <option value="cancelled">{t.cancelled}</option>
              </Select>
            </Field>
            {/* A paid row must carry its payment date (DB constraint tx_paid_needs_date);
                editing a paid row without this field used to blank it and fail. */}
            {status === "paid" && (
              <Field label={t.paidOn} htmlFor={id("paidOn")} required>
                <Input id={id("paidOn")} type="date" name="paid_on" defaultValue={initial?.paid_on ?? todayAthens()} required />
              </Field>
            )}
          </div>
        </Group>

        <Group title={t.groups.mapping}>
          <Field label={t.contact} htmlFor={id("contact")}>
            <Select
              id={id("contact")}
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
            <Field
              label={
                <>
                  {t.project}
                  {aiBadge}
                </>
              }
              htmlFor={id("project")}
            >
              <Select
                id={id("project")}
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
            <Field
              label={
                <>
                  {t.category}
                  {aiBadge}
                </>
              }
              htmlFor={id("category")}
            >
              <Select
                id={id("category")}
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

          <Field label={t.account} htmlFor={id("account")} required>
            <Select id={id("account")} name="account_id" defaultValue={initial?.account_id ?? ""} required>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t.scope} htmlFor={id("scope")}>
              <Select id={id("scope")} name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="business">{t.scopeValues.business}</option>
                <option value="personal">{t.scopeValues.personal}</option>
              </Select>
            </Field>
            {scope === "personal" && (
              <Field label={t.property} htmlFor={id("property")}>
                <Select id={id("property")} name="property_project_id" defaultValue={initial?.property_project_id ?? ""}>
                  <option value="">—</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </Group>

        <Group title={t.groups.other}>
          <Field label={t.invoiceNumber} htmlFor={id("invoice")}>
            <Input id={id("invoice")} name="invoice_number" defaultValue={initial?.invoice_number ?? ""} />
          </Field>
          <Field label={t.description} htmlFor={id("description")}>
            <Input id={id("description")} name="description" defaultValue={initial?.description ?? ""} />
          </Field>
        </Group>

        {error && (
          <div ref={intoView}>
            <Notice tone="negative" role="alert">
              {error}
            </Notice>
          </div>
        )}

        {duplicates.length > 0 && (
          <div ref={intoView}>
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
          </div>
        )}

        <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-hairline bg-raised px-5 py-4 md:-mx-8 md:px-8">
          <Button type="button" variant="secondary" onClick={onClose}>
            {el.common.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "…" : el.common.save}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
