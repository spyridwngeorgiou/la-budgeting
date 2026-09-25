"use client";

import { useState } from "react";
import { Button, Input, Select, Label, Field } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { formatMoney } from "@/lib/format";
import { recordPartialPayment } from "./actions";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded bg-white p-5">
        <h2 className="mb-1 text-base font-semibold">Μερική πληρωμή</h2>
        <p className="mb-4 text-sm text-ink-muted">
          {label} · υπόλοιπο <span className="font-mono">{formatMoney(remaining)}</span>
        </p>
        <form
          action={async (formData) => {
            setError(null);
            try {
              await recordPartialPayment(transactionId, formData);
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
              <Input type="date" name="paid_on" defaultValue={new Date().toISOString().slice(0, 10)} required />
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

          <div className="rounded bg-bg p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-muted">Καταγράφεται ως πληρωμένη</span>
              <span className="font-mono">{formatMoney(paid)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">Παραμένει εκκρεμές</span>
              <span className={`font-mono ${left < 0 ? "text-red-ink" : ""}`}>{formatMoney(Math.max(left, 0))}</span>
            </div>
            {paid > 0 && left === 0 && (
              <p className="mt-1 text-xs text-ink-faint">Ολόκληρο το υπόλοιπο — η κίνηση θα σημειωθεί ως πληρωμένη.</p>
            )}
          </div>

          {error && <p className="text-sm text-red-ink">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {el.common.cancel}
            </Button>
            <SubmitButton>Καταχώριση</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
