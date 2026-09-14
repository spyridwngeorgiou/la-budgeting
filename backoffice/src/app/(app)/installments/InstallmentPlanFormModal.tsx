"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { VAT_RATES } from "@/lib/domain/enums";

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

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Νέο Σχέδιο Δόσεων</Button>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded bg-white p-5">
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
          className="flex flex-col gap-3"
        >
          <Field>
            <Label>Ετικέτα Σχεδίου</Label>
            <Input name="label" required placeholder="π.χ. Μίσθωμα Λαζαράκη" />
          </Field>

          <div className="flex gap-2">
            {(["expense", "income"] as const).map((d) => (
              <label key={d} className="flex flex-1 items-center justify-center gap-2 rounded border border-line-strong px-3 py-2 text-sm">
                <input type="radio" name="direction" value={d} defaultChecked={d === "expense"} />
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
              <Label>Ποσό ανά Δόση</Label>
              <Input type="number" step="0.01" name="amount_per_installment" required />
            </Field>
            {hasInvoice && (
              <Field>
                <Label>ΦΠΑ %</Label>
                <Select name="vat_rate" defaultValue="0.24">
                  {VAT_RATES.map((r) => (
                    <option key={r} value={r}>
                      {(r * 100).toFixed(0)}%
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
                defaultValue={new Date().toISOString().slice(0, 10)}
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

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {el.common.cancel}
            </Button>
            <SubmitButton>{el.common.save}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
