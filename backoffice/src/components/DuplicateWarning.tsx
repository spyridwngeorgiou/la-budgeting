"use client";

import { Button } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { formatDate, formatMoney } from "@/lib/format";
import type { DuplicateCandidate } from "@/lib/ingest/duplicates";

// «Πιθανό διπλότυπο»: shown in place of saving when find_possible_duplicates
// (0050) returns something. A warning, not a block -- the user can look and
// still save, which resubmits the same form with confirm_duplicate=1.
export function DuplicateWarning({
  duplicates,
  onConfirm,
  onCancel,
}: {
  duplicates: DuplicateCandidate[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alert" className="rounded-lg border border-amber-ink/40 bg-amber-bg p-3 text-sm text-amber-ink">
      <p className="font-semibold">{el.ingest.possibleDuplicate}</p>
      <p className="mt-1">{el.ingest.possibleDuplicateHint}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {duplicates.map((d) => (
          <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded bg-surface/60 px-2 py-1 text-ink">
            <span>
              {formatDate(d.tx_date)} · {d.contact_name ?? d.counterparty_name ?? d.description ?? "—"}
              {d.invoice_number ? ` · ${d.invoice_number}` : ""}
            </span>
            <span className="font-mono">{formatMoney(d.gross_amount)}</span>
            <span className="w-full text-xs text-ink-muted">{el.ingest.duplicateReason[d.reason]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {el.common.cancel}
        </Button>
        <Button type="button" onClick={onConfirm}>
          {el.ingest.saveAnyway}
        </Button>
      </div>
    </div>
  );
}
