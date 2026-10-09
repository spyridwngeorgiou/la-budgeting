"use client";

import { useState } from "react";
import { Button, Field, Input, Label } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { assertAccountBalance } from "./actions";
import { todayAthens } from "@/lib/dates";
import { Modal } from "@/components/Modal";
import { errorOf } from "@/lib/actions";

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
  const [error, setError] = useState<string | null>(null);
  const today = todayAthens();

  return (
    <>
      <Button
        type="button"
        variant={hasChecks ? "secondary" : "primary"}
        className="!px-2.5 !py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        Νέος έλεγχος
      </Button>
      {open && (
        <Modal onClose={() => setOpen(false)} className="w-[calc(100%-2rem)] max-w-sm rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-ink">Νέος έλεγχος υπολοίπου</h2>
          <p className="mb-3 text-xs text-ink-muted">
            Η εφαρμογή περιμένει σήμερα <span className="font-mono font-medium text-ink">{formatMoney(expectedToday)}</span>
          </p>
          <form
            action={async (formData) => {
              setError(null);
              const message = errorOf(await assertAccountBalance(accountId, formData));
              if (message) return setError(message);
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Άκυρο
              </Button>
              <Button type="submit">Έλεγχος</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
