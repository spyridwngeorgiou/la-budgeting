"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field, Modal } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { formatMoney } from "@/lib/format";
import { recordPartialPayment } from "./actions";
import { todayAthens } from "@/lib/dates";
import { errorOf } from "@/lib/actions";

interface Props {
  transactionId: string;
  label: string;
  remaining: number;
  accountId: string | null;
  accounts: { id: string; label: string }[];
  onClose: () => void;
}

// Pay part of a pending commitment. The server records the paid slice as
// its own paid row and shrinks the commitment by the same amount in one
// atomic step -- the two manual edits the workbook needed (rows 79/87).
export function PartialPaymentModal({ transactionId, label, remaining, accountId, accounts, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const paid = Number(amount) || 0;
  const left = Math.round((remaining - paid) * 100) / 100;

  return (
    <Modal
      onClose={onClose}
      className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto border border-hairline bg-raised p-5 md:p-6"
      closeOnBackdrop={false}
    >
      <h2 className="border-b border-rule pb-3 text-section font-normal text-ink">Μερική πληρωμή</h2>
      <p className="mt-3 mb-4 text-small text-muted">
        {label} · υπόλοιπο <span className="num text-ink">{formatMoney(remaining)}</span>
      </p>
      <form
        action={async (formData) => {
          setError(null);
          try {
            const message = errorOf(await recordPartialPayment(transactionId, formData));
            if (message) return setError(message);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <Label>Ποσό που πληρώθηκε</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={remaining}
              name="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field>
            <Label>Ημ/νία πληρωμής</Label>
            <Input type="date" name="paid_on" defaultValue={todayAthens()} required />
          </Field>
        </div>
        <Field>
          <Label>{el.transaction.account}</Label>
          <Select name="account_id" defaultValue={accountId ?? ""} required>
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

        {error && (
          <p role="alert" className="border-l-2 border-negative pl-3 text-body text-negative">
            {error}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {el.common.cancel}
          </Button>
          <SubmitButton>Καταχώριση</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
