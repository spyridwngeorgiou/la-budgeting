"use client";

import { useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/format";
import { assertAccountBalance } from "./actions";

export interface LatestAssertion {
  as_of_date: string;
  asserted_balance: number;
  computed_balance: number;
}

// Drift bands are a judgement call, not a hard rule -- zero (rounding),
// under €50 (amber, worth a glance), €50+ (red, something's actually
// missing from the ledger). Tune freely, this is display-only.
function driftTone(drift: number): "green" | "amber" | "red" {
  const abs = Math.abs(drift);
  if (abs < 1) return "green";
  if (abs < 50) return "amber";
  return "red";
}

export function BalanceAssertion({ accountId, latest }: { accountId: string; latest: LatestAssertion | null }) {
  const [open, setOpen] = useState(!latest);
  const drift = latest ? latest.asserted_balance - latest.computed_balance : null;

  return (
    <div className="mt-2 border-t border-line/60 pt-2">
      {latest && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-ink-faint">Έλεγχος {formatDate(latest.as_of_date)}</span>
          <Badge tone={driftTone(drift!)}>
            {Math.abs(drift!) < 1 ? "ταιριάζει" : `διαφορά ${formatMoney(drift!)}`}
          </Badge>
        </div>
      )}
      {open ? (
        <form
          action={async (formData) => {
            await assertAccountBalance(accountId, formData);
            setOpen(false);
          }}
          className="mt-1.5 flex items-center gap-1.5"
        >
          <input type="hidden" name="as_of_date" value={new Date().toISOString().slice(0, 10)} />
          <Input
            type="number"
            step="0.01"
            name="asserted_balance"
            placeholder="Πραγματικό υπόλοιπο"
            required
            className="!py-1 text-xs"
          />
          <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
            Καταχώρηση
          </Button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs text-ink-faint underline">
          Νέος έλεγχος
        </button>
      )}
    </div>
  );
}
