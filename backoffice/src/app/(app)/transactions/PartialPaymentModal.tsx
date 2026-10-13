"use client";

import { useId, useState } from "react";
import { Field, FormDrawer, Input, MoneyInput, Select, useToast } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { formatMoney } from "@/lib/format";
import { parseAmountInput } from "@/lib/amountInput";
import { toCents } from "@/lib/finance/money";
import { recordPartialPayment } from "./actions";
import { todayAthens } from "@/lib/dates";

interface Props {
  transactionId: string;
  label: string;
  remaining: number;
  accountId: string | null;
  accounts: { id: string; label: string }[];
  onClose: () => void;
}

// «Μερική πληρωμή» of a pending commitment, in the side drawer. The server
// records the paid slice as its own paid row and shrinks the commitment by
// the same amount in one atomic step -- the two manual edits the workbook
// needed (rows 79/87).
export function PartialPaymentModal({ transactionId, label, remaining, accountId, accounts, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const { show } = useToast();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const paid = parseAmountInput(amount) ?? 0;
  const left = Math.round((remaining - paid) * 100) / 100;

  return (
    <FormDrawer
      onClose={onClose}
      eyebrow={label}
      title={el.transaction.partialTitle}
      submitLabel="Καταχώριση"
      action={async (formData) => {
        const value = parseAmountInput(amount);
        if (value === null) return { error: el.transaction.invalidAmount };
        if (value <= 0 || toCents(value) > toCents(remaining)) return { error: el.transaction.partialTooMuch };
        return recordPartialPayment(transactionId, formData);
      }}
      onSuccess={() => show(el.common.saved)}
    >
      <p className="text-small text-muted">
        Υπόλοιπο <span className="num text-ink">{formatMoney(remaining)}</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ποσό που πληρώθηκε" htmlFor={id("amount")} required>
          <MoneyInput
            id={id("amount")}
            name="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
            className="w-full"
          />
        </Field>
        <Field label={el.transaction.paidOn} htmlFor={id("paidOn")} required>
          <Input id={id("paidOn")} type="date" name="paid_on" defaultValue={todayAthens()} required />
        </Field>
      </div>
      <Field label={el.transaction.account} htmlFor={id("account")} required>
        <Select id={id("account")} name="account_id" defaultValue={accountId ?? ""} required>
          <option value="">—</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="border-t border-hairline text-body">
        <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2.5">
          <span className="text-small text-muted">Καταγράφεται ως πληρωμένη</span>
          <span className="num text-ink">{formatMoney(paid)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2.5">
          <span className="text-small text-muted">Παραμένει εκκρεμές</span>
          <span className={`num ${left < 0 ? "text-negative" : "text-ink"}`}>{formatMoney(Math.max(left, 0))}</span>
        </div>
        {paid > 0 && left === 0 && (
          <p className="mt-2 text-small text-muted">Ολόκληρο το υπόλοιπο — η κίνηση θα σημειωθεί ως πληρωμένη.</p>
        )}
      </div>
    </FormDrawer>
  );
}
