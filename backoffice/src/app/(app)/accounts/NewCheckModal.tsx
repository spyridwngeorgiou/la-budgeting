"use client";

import { useId } from "react";
import { Field, Input, MoneyInput } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { todayAthens } from "@/lib/dates";
import { el } from "@/lib/i18n/el";

// The fields of a new balance check (assertAccountBalance). They sit in the
// «Νέος έλεγχος» drawer (accounts/CheckDrawer.tsx), which owns the form,
// its submit and its errors; the result shows on the account page
// («Έλεγχοι υπολοίπου», BalanceAssertion.tsx).
export function NewCheckFields({ expectedToday, defaultFrom }: { expectedToday: number; defaultFrom: string }) {
  const today = todayAthens();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  return (
    <>
      <p className="text-small text-muted">
        Η εφαρμογή περιμένει σήμερα <span className="num text-ink">{formatMoney(expectedToday)}</span>
      </p>
      <Field label={el.account.asserted} htmlFor={id("balance")} required>
        <MoneyInput id={id("balance")} name="asserted_balance" placeholder="0,00" required autoFocus className="w-full" />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="στις" htmlFor={id("asOf")} required>
          <Input id={id("asOf")} type="date" name="as_of_date" defaultValue={today} max={today} required />
        </Field>
        <Field label="Έλεγχος από" htmlFor={id("from")}>
          <Input id={id("from")} type="date" name="period_start" defaultValue={defaultFrom} />
        </Field>
      </div>
    </>
  );
}
