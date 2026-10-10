"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { LIABILITY_STATE, type LiabilityState } from "@/lib/domain/enums";
import { FormModal } from "@/components/Modal";
import type { ActionResult } from "@/lib/actions";

const STATE_LABELS: Record<LiabilityState, string> = {
  in_application: "Σε αίτηση",
  approved: "Εγκεκριμένο",
  disbursed: "Εκταμιευμένο",
  repaid: "Αποπληρωμένο",
};

export interface LoanDrawdownInitial {
  scheduled_month: string; // 'YYYY-MM-DD'
  amount: number;
  done: boolean;
}

export interface LoanInitial {
  id?: string;
  label?: string;
  principal?: number;
  interest_rate?: number;
  term_years?: number;
  grace_years?: number;
  first_amortisation_month?: string | null;
  state?: LiabilityState;
  notes?: string | null;
  drawdowns?: LoanDrawdownInitial[];
}

interface DrawdownRow {
  key: number;
  month: string; // 'YYYY-MM'
  amount: string;
  done: boolean;
}

let nextKey = 1;

export function LoanFormModal({
  action,
  initial,
  trigger,
}: {
  action: (formData: FormData) => Promise<ActionResult | void>;
  initial?: LoanInitial;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DrawdownRow[]>([]);

  function openModal() {
    setRows(
      (initial?.drawdowns ?? []).map((d) => ({
        key: nextKey++,
        month: d.scheduled_month.slice(0, 7),
        amount: String(d.amount),
        done: d.done,
      })),
    );
    setOpen(true);
  }

  return (
    <>
      <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={openModal}>
        {trigger ?? "+ Δάνειο"}
      </Button>
      {open && (
        <FormModal
          onClose={() => setOpen(false)}
          title={initial?.id ? "Επεξεργασία δανείου" : "Νέο δάνειο"}
          action={action}
          className="max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded bg-white p-5"
        >
          <input type="hidden" name="drawdowns_present" value="1" />
          <Field>
            <Label>Ετικέτα</Label>
            <Input name="label" defaultValue={initial?.label} required />
          </Field>
          <Field>
            <Label>Κεφάλαιο (€)</Label>
            <Input type="number" step="0.01" name="principal" defaultValue={initial?.principal} required />
          </Field>
          <Field>
            <Label>Επιτόκιο (ετήσιο, %)</Label>
            <Input
              type="number"
              step="0.001"
              name="interest_rate_pct"
              defaultValue={initial?.interest_rate != null ? initial.interest_rate * 100 : undefined}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>Διάρκεια (έτη)</Label>
              <Input type="number" name="term_years" defaultValue={initial?.term_years} required />
            </Field>
            <Field>
              <Label>Χάρη (έτη)</Label>
              <Input type="number" step="0.5" name="grace_years" defaultValue={initial?.grace_years ?? 0} />
            </Field>
          </div>
          <Field>
            <Label>Πρώτος μήνας εξόφλησης</Label>
            <Input type="date" name="first_amortisation_month" defaultValue={initial?.first_amortisation_month ?? ""} />
          </Field>
          <Field>
            <Label>Κατάσταση</Label>
            <Select name="state" defaultValue={initial?.state ?? "in_application"}>
              {LIABILITY_STATE.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-ink-faint">
              Οι δόσεις μπαίνουν στην πρόβλεψη ταμείου μόλις το δάνειο είναι εγκεκριμένο ή εκταμιευμένο.
            </p>
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-ink">Εκταμιεύσεις</legend>
            {rows.length === 0 && <p className="text-xs text-ink-faint">Καμία ακόμα. Χωρίς εκταμίευση δεν υπάρχουν δόσεις.</p>}
            {rows.map((r, i) => (
              <div key={r.key} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                <Input
                  type="month"
                  name="drawdown_month"
                  aria-label="Μήνας εκταμίευσης"
                  value={r.month}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))}
                />
                <Input
                  type="number"
                  step="0.01"
                  name="drawdown_amount"
                  aria-label="Ποσό εκταμίευσης"
                  value={r.amount}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                />
                <label className="flex items-center gap-1 text-xs text-ink-muted">
                  <input type="hidden" name="drawdown_done" value={r.done ? "1" : "0"} />
                  <input
                    type="checkbox"
                    checked={r.done}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                  />
                  έγινε
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  className="!px-2 !py-1 text-xs"
                  aria-label="Αφαίρεση εκταμίευσης"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                className="!px-2 !py-1 text-xs"
                onClick={() => setRows([...rows, { key: nextKey++, month: "", amount: "", done: false }])}
              >
                + Εκταμίευση
              </Button>
            </div>
          </fieldset>

          <Field>
            <Label>Σημειώσεις</Label>
            <textarea
              name="notes"
              defaultValue={initial?.notes ?? ""}
              rows={2}
              className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-sage-strong focus:outline-none"
            />
          </Field>
        </FormModal>
      )}
    </>
  );
}
