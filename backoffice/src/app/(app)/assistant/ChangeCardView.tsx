"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Notice, SpecTable, StatusDot, Td, Th, Tr, useConfirm, useToast } from "@/components/ui";
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
// proposed / then / now side by side; approving anyway asks first (the
// app's one confirm dialog). The status is a dot, never a badge; a delete
// says so in the colour of its title.
export function ChangeCardView({ initial, canReview }: { initial: ChangeCard; canReview: boolean }) {
  const [card, setCard] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const { show } = useToast();
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
      if (result.data) {
        setCard(result.data);
        // A conflict or a failure stays on the card; a decision says so.
        if (result.data.status === "approved" || result.data.status === "rejected") show(STATUS_LABEL[result.data.status]);
      }
      router.refresh();
    });
  }

  return (
    <div className="border-l-2 border-ai-border py-2 pl-3 text-body text-ink" data-change-id={card.id}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={isDelete ? "font-medium text-negative" : "font-medium text-ink"}>{card.title}</span>
        <StatusDot tone={STATUS_TONE[card.status] ?? "neutral"} label={STATUS_LABEL[card.status] ?? card.status} />
      </div>
      {card.reason && <p className="mb-2 text-muted">{card.reason}</p>}
      {card.untrusted && open && (
        <Notice tone="warning" size="small" className="mb-2">
          Η πρόταση έγινε αφού ο βοηθός διάβασε ελεύθερο κείμενο από τα δεδομένα (περιγραφές, σημειώσεις). Ελέγξτε
          τη με προσοχή.
        </Notice>
      )}

      {card.status === "conflict" && card.conflict.length > 0 ? (
        <div className="mb-3">
          <Notice tone="warning" size="small" className="mb-1">
            Η εγγραφή άλλαξε μετά την πρόταση. Συγκρίνετε πριν εγκρίνετε.
          </Notice>
          <SpecTable label="Σύγκριση πεδίων" tableClassName="text-small">
            <thead>
              <tr>
                <Th>Πεδίο</Th>
                <Th>Τότε</Th>
                <Th>Τώρα</Th>
                <Th>Προτείνεται</Th>
              </tr>
            </thead>
            <tbody>
              {card.conflict.map((c) => (
                <Tr key={c.field}>
                  <Td strong>{c.field}</Td>
                  <Td className="num text-muted">{formatFieldValue(c.before)}</Td>
                  <Td className="num text-warning">{formatFieldValue(c.current)}</Td>
                  <Td strong className="num">{isDelete ? "(διαγραφή)" : formatFieldValue(c.after)}</Td>
                </Tr>
              ))}
            </tbody>
          </SpecTable>
        </div>
      ) : (
        <SpecTable label="Πεδία αλλαγής" className="mb-3" tableClassName="text-small">
          <thead>
            <tr>
              <Th>Πεδίο</Th>
              {card.operation !== "insert" && card.operation !== "action" && <Th>Πριν</Th>}
              {!isDelete && <Th>Μετά</Th>}
            </tr>
          </thead>
          <tbody>
            {card.fields.length === 0 ? (
              <tr>
                <Td className="text-muted" colSpan={3}>
                  Καμία διαφορά σε επιτρεπτά πεδία.
                </Td>
              </tr>
            ) : (
              card.fields.map((f) => (
                <Tr key={f.field}>
                  <Td strong>{f.field}</Td>
                  {card.operation !== "insert" && card.operation !== "action" && (
                    <Td className="num text-muted">{formatFieldValue(f.before)}</Td>
                  )}
                  {!isDelete && <Td strong className="num">{formatFieldValue(f.after)}</Td>}
                </Tr>
              ))
            )}
          </tbody>
        </SpecTable>
      )}

      {(error || card.error) && (
        <Notice tone="negative" size="small" role="alert" className="mb-2">
          {error ?? card.error}
        </Notice>
      )}
      {card.resultHref && (
        <Link href={card.resultHref} className="mb-2 inline-flex min-h-8 items-center text-small font-medium text-ink underline underline-offset-4">
          Άνοιγμα →
        </Link>
      )}

      {canReview && open && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run("reject")}>
            Απόρριψη
          </Button>
          {card.status === "conflict" ? (
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={async () => {
                const ok = await confirm({
                  message: "Οι τιμές «Τώρα» θα αντικατασταθούν από τις προτεινόμενες. Συνέχεια;",
                  confirmLabel: "Έγκριση",
                });
                if (ok) run("force");
              }}
            >
              Έγκριση παρ’ όλα αυτά
            </Button>
          ) : (
            <Button type="button" variant={isDelete ? "danger" : "primary"} disabled={pending} onClick={() => run("approve")}>
              Έγκριση
            </Button>
          )}
        </div>
      )}
      {!canReview && open && <p className="text-small text-muted">Την έγκριση κάνει χρήστης με δικαίωμα επεξεργασίας.</p>}

      {dialog}
    </div>
  );
}
