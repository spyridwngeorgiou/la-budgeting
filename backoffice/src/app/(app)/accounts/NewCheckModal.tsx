"use client";

import { useState } from "react";
import { Button, Field, Input, Label } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { assertAccountBalance } from "./actions";

// Data entry, split out from the read-only breakdown (BalanceAssertion) so
// reviewing accounts and entering a new check are two differently-sized
// interactions instead of one crowded card -- same trigger+overlay shape as
// every other *FormModal in this app (ProjectNoteFormModal, UtilityFormModal,
// AccountFormModal on this very page).
export function NewCheckModal({
  accountId,
  expectedToday,
  defaultFrom,
  hasChecks,
}: {
  accountId: string;
  expectedToday: number;
  defaultFrom: string;
  hasChecks: boolean;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (!open) {
    return (
      <Button
        type="button"
        variant={hasChecks ? "secondary" : "primary"}
        className="!px-2.5 !py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        Νέος έλεγχος
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-semibold text-ink">Νέος έλεγχος υπολοίπου</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Η εφαρμογή περιμένει σήμερα <span className="font-mono font-medium text-ink">{formatMoney(expectedToday)}</span>
        </p>
        <form
          action={async (formData) => {
            await assertAccountBalance(accountId, formData);
            setOpen(false);
          }}
          className="flex flex-col gap-3"
        >
          <Field>
            <Label>Πραγματικό υπόλοιπο</Label>
            <Input type="number" step="0.01" name="asserted_balance" placeholder="0,00" required autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field>
              <Label>στις</Label>
              <Input type="date" name="as_of_date" defaultValue={today} max={today} required />
            </Field>
            <Field>
              <Label>Έλεγχος από</Label>
              <Input type="date" name="period_start" defaultValue={defaultFrom} />
            </Field>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Άκυρο
            </Button>
            <Button type="submit">Έλεγχος</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
