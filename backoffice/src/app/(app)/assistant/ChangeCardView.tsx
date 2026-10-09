"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { formatFieldValue, STATUS_LABEL, type ChangeCard } from "@/lib/ai/changeCards";
import { approveChange, rejectChange } from "./change-actions";

const STATUS_TONE = {
  pending: "ai",
  approved: "green",
  rejected: "neutral",
  conflict: "amber",
  failed: "red",
} as const;

// One proposal from the assistant: what would change, and Έγκριση /
// Απόρριψη. Used inline in the chat and in the «Εκκρεμότητες» panel. A
// conflict (the row changed since the proposal in a field it touches) shows
// proposed / then / now side by side; approving anyway asks first.
export function ChangeCardView({ initial, canReview }: { initial: ChangeCard; canReview: boolean }) {
  const [card, setCard] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [confirmForce, setConfirmForce] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const open = card.status === "pending" || card.status === "conflict";
  const isDelete = card.operation === "delete";

  function run(kind: "approve" | "force" | "reject") {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "reject" ? await rejectChange(card.id) : await approveChange(card.id, kind === "force");
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.data) setCard(result.data);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-ai-border bg-surface p-3 text-sm text-ink" data-change-id={card.id}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={isDelete ? "red" : "ai"}>{card.title}</Badge>
        <Badge tone={STATUS_TONE[card.status] ?? "neutral"}>{STATUS_LABEL[card.status] ?? card.status}</Badge>
      </div>
      {card.reason && <p className="mb-2 text-ink-muted">{card.reason}</p>}
      {card.untrusted && open && (
        <p className="mb-2 rounded bg-amber-bg px-2 py-1 text-xs text-amber-ink">
          Η πρόταση έγινε αφού ο βοηθός διάβασε ελεύθερο κείμενο από τα δεδομένα (περιγραφές, σημειώσεις). Ελέγξτε
          τη με προσοχή.
        </p>
      )}

      {card.status === "conflict" && card.conflict.length > 0 ? (
        <div className="mb-3 overflow-x-auto rounded border border-amber-ink/30">
          <p className="bg-amber-bg px-2 py-1 text-xs text-amber-ink">
            Η εγγραφή άλλαξε μετά την πρόταση. Συγκρίνετε πριν εγκρίνετε.
          </p>
          <table className="w-full text-left text-xs">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-1.5">Πεδίο</th>
                <th className="p-1.5">Τότε</th>
                <th className="p-1.5">Τώρα</th>
                <th className="p-1.5">Προτείνεται</th>
              </tr>
            </thead>
            <tbody>
              {card.conflict.map((c) => (
                <tr key={c.field} className="border-t border-line">
                  <td className="p-1.5 font-medium">{c.field}</td>
                  <td className="p-1.5 font-mono text-ink-muted">{formatFieldValue(c.before)}</td>
                  <td className="p-1.5 font-mono text-amber-ink">{formatFieldValue(c.current)}</td>
                  <td className="p-1.5 font-mono text-sage-ink">{isDelete ? "(διαγραφή)" : formatFieldValue(c.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mb-3 overflow-x-auto rounded border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-1.5">Πεδίο</th>
                {card.operation !== "insert" && card.operation !== "action" && <th className="p-1.5">Πριν</th>}
                {!isDelete && <th className="p-1.5">Μετά</th>}
              </tr>
            </thead>
            <tbody>
              {card.fields.length === 0 ? (
                <tr>
                  <td className="p-1.5 text-ink-faint" colSpan={3}>
                    Καμία διαφορά σε επιτρεπτά πεδία.
                  </td>
                </tr>
              ) : (
                card.fields.map((f) => (
                  <tr key={f.field} className="border-t border-line">
                    <td className="p-1.5 font-medium">{f.field}</td>
                    {card.operation !== "insert" && card.operation !== "action" && (
                      <td className="p-1.5 font-mono text-red-ink">{formatFieldValue(f.before)}</td>
                    )}
                    {!isDelete && <td className="p-1.5 font-mono text-sage-ink">{formatFieldValue(f.after)}</td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {(error || card.error) && (
        <p role="alert" className="mb-2 text-xs text-red-ink">
          {error ?? card.error}
        </p>
      )}
      {card.resultHref && (
        <Link href={card.resultHref} className="mb-2 block text-xs font-medium underline">
          Άνοιγμα →
        </Link>
      )}

      {canReview && open && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run("reject")}>
            Απόρριψη
          </Button>
          {card.status === "conflict" ? (
            <Button type="button" variant="danger" disabled={pending} onClick={() => setConfirmForce(true)}>
              Έγκριση παρ' όλα αυτά
            </Button>
          ) : (
            <Button type="button" variant={isDelete ? "danger" : "primary"} disabled={pending} onClick={() => run("approve")}>
              Έγκριση
            </Button>
          )}
        </div>
      )}
      {!canReview && open && <p className="text-xs text-ink-faint">Την έγκριση κάνει χρήστης με δικαίωμα επεξεργασίας.</p>}

      {confirmForce && (
        <Modal onClose={() => setConfirmForce(false)} title="Έγκριση παρά τη σύγκρουση">
          <p className="mb-4 text-sm text-ink-muted">
            Οι τιμές «Τώρα» θα αντικατασταθούν από τις προτεινόμενες. Συνέχεια;
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmForce(false)}>
              Άκυρο
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => {
                setConfirmForce(false);
                run("force");
              }}
            >
              Έγκριση
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
