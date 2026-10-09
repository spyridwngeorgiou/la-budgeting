"use client";

import { useState, useTransition } from "react";
import { Badge, Select } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import type { IngestDecision } from "@/lib/ingest/types";
import { setRowDecision } from "../actions";

export interface MatchOption {
  decision: IngestDecision;
  transactionIds: string[];
  label: string;
  score: number;
  reasons: { code: keyof typeof el.ingest.reason; points: number }[];
}

const KIND_TO_DECISION: Record<string, IngestDecision> = {
  single: "settle",
  partial: "settle_partial",
  many: "settle_many",
  already_recorded: "link_existing",
};
export function decisionForKind(kind: string): IngestDecision {
  return KIND_TO_DECISION[kind] ?? "settle";
}

const encode = (decision: string, ids: string[]) => `${decision}|${ids.join(",")}`;

// One staged line's decision: new transaction, skip, or one of the matcher's
// candidates (with the reasons behind its score as chips).
export function RowDecision({
  batchId,
  rowId,
  decision,
  targets,
  options,
  editable,
}: {
  batchId: string;
  rowId: string;
  decision: IngestDecision;
  targets: string[];
  options: MatchOption[];
  editable: boolean;
}) {
  const [value, setValue] = useState(encode(decision, targets));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = options.find((o) => encode(o.decision, o.transactionIds) === value) ?? null;

  if (!editable) {
    return <span className="text-xs">{el.ingest.decision[decision]}</span>;
  }

  return (
    <div className="flex min-w-48 flex-col gap-1">
      <Select
        value={value}
        disabled={pending}
        className={decision === "pending" ? "border-amber-ink/70" : ""}
        onChange={(e) => {
          const next = e.target.value;
          const [d, ids] = next.split("|");
          setValue(next);
          setError(null);
          startTransition(async () => {
            const result = await setRowDecision(batchId, rowId, d, ids ? ids.split(",") : []);
            if ("error" in result) setError(result.error);
          });
        }}
      >
        {decision === "pending" && (
          <option value={encode("pending", [])} disabled>
            — {el.ingest.decision.pending} —
          </option>
        )}
        {options.map((o) => (
          <option key={encode(o.decision, o.transactionIds)} value={encode(o.decision, o.transactionIds)}>
            {el.ingest.decision[o.decision]}: {o.label} ({o.score})
          </option>
        ))}
        <option value={encode("create", [])}>{el.ingest.decision.create}</option>
        <option value={encode("skip", [])}>{el.ingest.decision.skip}</option>
      </Select>
      {(selected ?? (decision === "pending" ? options[0] : null))?.reasons.map((r) => (
        <span key={r.code} className="mr-1 inline-block">
          <Badge tone={r.points < 0 ? "red" : "neutral"}>
            {el.ingest.reason[r.code]} {r.points > 0 ? `+${r.points}` : r.points}
          </Badge>
        </span>
      ))}
      {error && <span className="text-xs text-red-ink">{error}</span>}
    </div>
  );
}
