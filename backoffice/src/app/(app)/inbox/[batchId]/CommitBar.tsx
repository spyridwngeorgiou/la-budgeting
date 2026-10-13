"use client";

import { useState, useTransition } from "react";
import { Button, Notice, useConfirm, useToast } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { commitIngest, discardBatch, undoIngest } from "../actions";

// «Οριστικοποίηση» / «Απόρριψη» / «Αναίρεση». The batch version loaded with
// the page goes with every call, so a commit over someone else's newer edits
// is refused (stale_version) instead of silently applying what this screen
// showed. The warnings about the rows sit above the table, not here.

const t = el.ingest.review;

// A committed batch: «Αναίρεση», and «Αναίρεση παρ' όλα αυτά» when some of
// its movements changed after the import. Nothing for the other statuses.
export function CommitBar({
  batchId,
  status,
  version,
  undoable = true,
}: {
  batchId: string;
  status: "staged" | "committed" | "undone" | "discarded";
  version: number;
  // false for batches backfilled from the old system (0072/0073): undo_ingest_batch refuses them.
  undoable?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const { show } = useToast();
  if (status !== "committed" || !undoable) return null;

  const undo = (force: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await undoIngest(batchId, version, force);
      if ("error" in result) setError(result.error);
      else if ("touched" in result) setTouched(result.touched);
      else {
        setTouched(null);
        show(t.undone);
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      {touched ? (
        <Button type="button" variant="danger" disabled={pending} onClick={() => undo(true)}>
          Αναίρεση παρ&apos; όλα αυτά
        </Button>
      ) : (
        <Button type="button" variant="secondary" disabled={pending} onClick={() => undo(false)}>
          {pending ? "…" : "Αναίρεση"}
        </Button>
      )}
      {touched && (
        <Notice tone="warning" size="small" className="max-w-md sm:text-right">
          {touched.length} κίνηση/εις άλλαξαν μετά την εισαγωγή. Η αναίρεση θα επαναφέρει μόνο όσα έκανε η εισαγωγή·
          οι μεταγενέστερες αλλαγές σε άλλα πεδία μένουν.
        </Notice>
      )}
      {error && (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}

// «Απόρριψη αρχείου» for a batch still in review: asks first, then the
// batch is set aside and the page goes back to the inbox.
export function DiscardButton({ batchId }: { batchId: string }) {
  const { confirm, dialog } = useConfirm();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          if (!(await confirm({ message: t.discardConfirm, confirmLabel: t.discard }))) return;
          startTransition(async () => {
            const result = await discardBatch(batchId);
            if (result && "error" in result) show(result.error, { tone: "negative" });
          });
        }}
      >
        {pending ? "…" : t.discard}
      </Button>
      {dialog}
    </>
  );
}

// The review's bottom bar, stuck to the bottom of the screen while the rows
// scroll: what the commit will do, and «Οριστικοποίηση (N)» with N the rows
// it writes. Disabled while a row still waits for a decision. On a phone
// the bar keeps clear of the «＋» button in the corner.
export function FinalizeBar({
  batchId,
  version,
  pendingCount,
  writeCount,
  skipCount,
}: {
  batchId: string;
  version: number;
  pendingCount: number;
  writeCount: number;
  skipCount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { show } = useToast();

  const commit = () => {
    setError(null);
    startTransition(async () => {
      const result = await commitIngest(batchId, version);
      if ("error" in result) setError(result.error);
      else show(t.committed);
    });
  };

  return (
    <div className="sticky bottom-0 z-20 flex flex-col gap-2 border-t border-hairline bg-canvas pt-3 pb-3 max-md:pr-20 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      {error && (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-small text-muted">
          {pendingCount > 0 ? (
            <span className="font-medium text-warning">
              <span className="num">{pendingCount}</span> {pendingCount === 1 ? t.undecidedOne : t.undecidedMany}
            </span>
          ) : (
            <>
              <span className="num text-ink">{writeCount}</span> {t.toWrite}
              {skipCount > 0 && (
                <>
                  {" · "}
                  <span className="num">{skipCount}</span> {t.toSkip}
                </>
              )}
            </>
          )}
        </p>
        <Button
          type="button"
          disabled={pending || pendingCount > 0}
          title={pendingCount > 0 ? `${pendingCount} ${pendingCount === 1 ? t.undecidedOne : t.undecidedMany}` : undefined}
          onClick={commit}
        >
          {pending ? "…" : `${t.commit} (${writeCount})`}
        </Button>
      </div>
    </div>
  );
}
