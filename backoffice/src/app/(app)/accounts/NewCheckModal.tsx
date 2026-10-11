"use client";

import { Field, Input, Label } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { todayAthens } from "@/lib/dates";

// The fields of a new balance check (assertAccountBalance), split out from
// the read-only breakdown (BalanceAssertion). They sit in the «Έλεγχος
// υπολοίπου» drawer of the account page (accounts/[id]/CheckDrawer.tsx),
// which owns the form, its submit and its errors.
export function NewCheckFields({ expectedToday, defaultFrom }: { expectedToday: number; defaultFrom: string }) {
  const today = todayAthens();
  return (
    <>
      <p className="text-small text-muted">
        Η εφαρμογή περιμένει σήμερα <span className="num text-ink">{formatMoney(expectedToday)}</span>
      </p>
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
    </>
  );
}
