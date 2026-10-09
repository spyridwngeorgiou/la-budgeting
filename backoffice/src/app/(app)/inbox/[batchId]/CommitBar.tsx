"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { commitIngest, discardBatch, undoIngest } from "../actions";

// «Οριστικοποίηση» / «Αναίρεση». The batch version loaded with the page goes
// with every call, so a commit over someone else's newer edits is refused
// (stale_version) instead of silently applying what this screen showed.
export function CommitBar({
  batchId,
  status,
  version,
  pendingCount,
  undoable = true,
}: {
  batchId: string;
  status: "staged" | "committed" | "undone" | "discarded";
  version: number;
  pendingCount: number;
  // false for batches backfilled from the old system (0072/0073): undo_ingest_batch refuses them.
  undoable?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { error: string } | { touched: string[] }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else if ("touched" in result) setTouched(result.touched);
      else setTouched(null);
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {(status === "staged" || status === "undone") && (
          <>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => discardBatch(batchId))}>
              Απόρριψη αρχείου
            </Button>
            <Button
              type="button"
              disabled={pending || pendingCount > 0}
              title={pendingCount > 0 ? `${pendingCount} γραμμές χωρίς απόφαση` : undefined}
              onClick={() => run(() => commitIngest(batchId, version))}
            >
              {pending ? "…" : "Οριστικοποίηση"}
            </Button>
          </>
        )}
        {status === "committed" && undoable && !touched && (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => undoIngest(batchId, version, false))}>
            {pending ? "…" : "Αναίρεση"}
          </Button>
        )}
        {status === "committed" && touched && (
          <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => undoIngest(batchId, version, true))}>
            Αναίρεση παρ&apos; όλα αυτά
          </Button>
        )}
      </div>
      {pendingCount > 0 && status !== "committed" && (
        <p className="text-xs text-amber-ink">{pendingCount} γραμμή/ές χρειάζονται απόφαση πριν την οριστικοποίηση.</p>
      )}
      {touched && (
        <p className="max-w-md text-right text-xs text-amber-ink">
          {touched.length} κίνηση/εις άλλαξαν μετά την εισαγωγή. Η αναίρεση θα επαναφέρει μόνο όσα έκανε η εισαγωγή·
          οι μεταγενέστερες αλλαγές σε άλλα πεδία μένουν.
        </p>
      )}
      {error && <p className="text-sm text-red-ink">{error}</p>}
    </div>
  );
}
