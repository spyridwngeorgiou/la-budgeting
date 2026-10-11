"use client";

import { useState } from "react";
import { formatPercent } from "@/lib/format";
import { Button, Input, Select, Label, Field, Modal } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { VAT_RATES } from "@/lib/domain/enums";
import { todayAthens } from "@/lib/dates";

interface Option {
  id: string;
  label: string;
}

interface Props {
  action: (formData: FormData) => Promise<void>;
  contacts: Option[];
  projects: Option[];
  categories: Option[];
  accounts: Option[];
}

export function InstallmentPlanFormModal({ action, contacts, projects, categories, accounts }: Props) {
  const [open, setOpen] = useState(false);
  const [hasInvoice, setHasInvoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="max-md:min-h-11">
        + Νέο Σχέδιο Δόσεων
      </Button>
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border border-hairline bg-raised p-5 md:p-6"
          closeOnBackdrop={false}
        >
          <form
            action={async (formData) => {
              setError(null);
              try {
                await action(formData);
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Σφάλμα");
              }
            }}
            className="flex flex-col gap-4"
          >
            <Field>
              <Label>Ετικέτα Σχεδίου</Label>
              <Input name="label" required placeholder="π.χ. Μίσθωμα Λαζαράκη" />
            </Field>

            <div className="flex">
              {(["expense", "income"] as const).map((d, i) => (
                <label
                  key={d}
                  className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 border border-chip-border px-3 py-2 text-body text-text has-[:checked]:border-navy has-[:checked]:bg-navy has-[:checked]:text-panel-ink md:min-h-10 ${
                    i > 0 ? "-ml-px" : ""
                  }`}
                >
                  <input type="radio" name="direction" value={d} defaultChecked={d === "expense"} className="accent-navy" />
                  {d === "expense" ? el.transaction.expense : el.transaction.income}
                </label>
              ))}
            </div>

            <Field>
              <Label>{el.transaction.contact}</Label>
              <Select name="contact_id">
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
                <Select name="project_id">
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
                <Select name="category_id">
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
              <Select name="account_id" required>
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
                <Label>Ποσό ανά Δόση</Label>
                <Input type="number" step="0.01" name="amount_per_installment" required />
              </Field>
              {hasInvoice && (
                <Field>
                  <Label>ΦΠΑ %</Label>
                  <Select name="vat_rate" defaultValue="0.24">
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
              <Field>
                <Label>Πρώτη Ημ/νία Λήξης</Label>
                <Input
                  type="date"
                  name="first_due_date"
                  defaultValue={todayAthens()}
                  required
                />
              </Field>
              <Field>
                <Label>Συχνότητα</Label>
                <Select name="frequency" defaultValue="monthly">
                  <option value="monthly">Μηνιαία</option>
                  <option value="quarterly">Τριμηνιαία</option>
                  <option value="semiannual">Εξαμηνιαία</option>
                  <option value="annual">Ετήσια</option>
                </Select>
              </Field>
            </div>

            <Field>
              <Label>Αριθμός Δόσεων (κενό = αόριστο)</Label>
              <Input type="number" name="installment_count" min="1" />
            </Field>

            {error && (
              <p role="alert" className="border-l-2 border-negative pl-3 text-body text-negative">
                {error}
              </p>
            )}

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {el.common.cancel}
              </Button>
              <SubmitButton>{el.common.save}</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
