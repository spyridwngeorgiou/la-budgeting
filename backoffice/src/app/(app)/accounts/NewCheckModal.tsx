"use client";

import { useState } from "react";
import { Button, Field, Input, Label, Modal } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { assertAccountBalance } from "./actions";
import { todayAthens } from "@/lib/dates";
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
        size="sm"
        className="max-md:min-h-11"
        onClick={() => setOpen(true)}
      >
        Νέος έλεγχος
      </Button>
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto border border-hairline bg-raised p-5 md:p-6"
        >
          <h2 className="border-b border-rule pb-3 text-section font-normal text-ink">Νέος έλεγχος υπολοίπου</h2>
          <p className="mt-3 mb-4 text-small text-muted">
            Η εφαρμογή περιμένει σήμερα <span className="num text-ink">{formatMoney(expectedToday)}</span>
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
            {error && (
              <p role="alert" className="border-l-2 border-negative pl-3 text-sm text-negative">
                {error}
              </p>
            )}
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
