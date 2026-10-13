"use client";

import { useId, useState } from "react";
import { formatPercent } from "@/lib/format";
import { Button, Checkbox, Field, FormDrawer, Input, MoneyInput, Select, useToast } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { VAT_RATES } from "@/lib/domain/enums";
import { todayAthens } from "@/lib/dates";
import { FieldGroup } from "../FieldGroup";
import { createInstallmentPlan } from "./actions";

const t = el.transaction;

interface Option {
  id: string;
  label: string;
}

// «+ Νέο σχέδιο δόσεων» and its side drawer. The action is imported here,
// so the server page passes only the option lists.
export function InstallmentPlanFormModal({
  contacts,
  projects,
  categories,
  accounts,
}: {
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [hasInvoice, setHasInvoice] = useState(false);
  const { show } = useToast();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const close = () => {
    setOpen(false);
    setHasInvoice(false);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t.plans.newButton}</Button>
      {open && (
        <FormDrawer onClose={close} title={t.plans.newTitle} action={createInstallmentPlan} onSuccess={() => show(el.common.saved)}>
          <FieldGroup title={t.groups.basics}>
            <Field label="Ετικέτα σχεδίου" htmlFor={id("label")} required>
              <Input id={id("label")} name="label" required placeholder="π.χ. Ρύθμιση ΕΦΚΑ" />
            </Field>

            <div className="flex flex-col">
              <span id={id("type")} className="mb-1 block text-small font-medium text-muted">
                {t.type}
              </span>
              <div role="radiogroup" aria-labelledby={id("type")} className="flex">
                {(["expense", "income"] as const).map((d, i) => (
                  <label
                    key={d}
                    className={`flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 border border-chip-border px-3 py-2 text-body text-text has-[:checked]:border-navy has-[:checked]:bg-navy has-[:checked]:text-panel-ink pointer-coarse:min-h-11 ${
                      i > 0 ? "-ml-px" : ""
                    }`}
                  >
                    <input type="radio" name="direction" value={d} defaultChecked={d === "expense"} className="accent-navy" />
                    {d === "expense" ? t.expense : t.income}
                  </label>
                ))}
              </div>
            </div>

            <Checkbox
              label={t.hasInvoice}
              name="has_invoice"
              checked={hasInvoice}
              onChange={(e) => setHasInvoice(e.target.checked)}
              className="self-start pointer-coarse:min-h-11"
            />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Ποσό ανά δόση" htmlFor={id("amount")} required>
                <MoneyInput id={id("amount")} name="amount_per_installment" required className="w-full" />
              </Field>
              {hasInvoice && (
                <Field label={`${t.vat} %`} htmlFor={id("vat")}>
                  <Select id={id("vat")} name="vat_rate" defaultValue="0.24">
                    {VAT_RATES.map((r) => (
                      <option key={r} value={r}>
                        {formatPercent(r, { digits: 0 })}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Πρώτη ημ/νία λήξης" htmlFor={id("first")} required>
                <Input id={id("first")} type="date" name="first_due_date" defaultValue={todayAthens()} required />
              </Field>
              <Field label="Συχνότητα" htmlFor={id("frequency")}>
                <Select id={id("frequency")} name="frequency" defaultValue="monthly">
                  <option value="monthly">Μηνιαία</option>
                  <option value="quarterly">Τριμηνιαία</option>
                  <option value="semiannual">Εξαμηνιαία</option>
                  <option value="annual">Ετήσια</option>
                </Select>
              </Field>
            </div>

            <Field label="Αριθμός δόσεων" hint="Κενό = αόριστο" htmlFor={id("count")}>
              <Input id={id("count")} type="number" name="installment_count" min="1" />
            </Field>
          </FieldGroup>

          <FieldGroup title={t.groups.mapping}>
            <Field label={t.contact} htmlFor={id("contact")}>
              <Select id={id("contact")} name="contact_id">
                <option value="">—</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t.project} htmlFor={id("project")}>
                <Select id={id("project")} name="project_id">
                  <option value="">—</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.category} htmlFor={id("category")}>
                <Select id={id("category")} name="category_id">
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
              <Select id={id("account")} name="account_id" required>
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldGroup>
        </FormDrawer>
      )}
    </>
  );
}
