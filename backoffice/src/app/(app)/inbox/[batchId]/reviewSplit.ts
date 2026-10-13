import type { IngestDecision } from "@/lib/ingest/types";

// The batch review in two groups: first the rows a person has to decide,
// then «▸ Βέβαιες (N)», the rows the system is sure about. The split reads
// what a row was when it was staged (the matcher's confidence, read errors,
// a new document), never the reviewer's own picks, so a row does not jump
// between the groups while it is being reviewed -- only a row that is still
// undecided always sits on top.

export interface ReviewRowFacts {
  decision: IngestDecision;
  // ingest_rows.meta.confidence: the matcher's, set at staging (bank lines).
  confidence?: string | null;
  // A document (AADE, AI capture), not a bank line: a new one always gets a
  // person's look (assignment, what the AI read).
  document: boolean;
  dedupStatus: string;
  parseErrors: number;
  // What the AI flagged on the row (meta.ai.needs_review_reasons).
  reviewReasons: number;
}

export function needsDecision(row: ReviewRowFacts, trustAuto: boolean): boolean {
  if (row.decision === "pending") return true;
  if (row.parseErrors > 0 || row.reviewReasons > 0) return true;
  if (row.document) return row.dedupStatus === "new";
  // A mere suggestion was left to the reviewer; so was every match on a
  // statement that failed its own checks (stageMovements' trustAuto).
  if (row.confidence === "suggest") return true;
  return row.confidence === "auto" && !trustAuto;
}

// Keeps the rows' order inside each group.
export function splitForReview<T>(
  rows: readonly T[],
  facts: (row: T) => ReviewRowFacts,
  trustAuto: boolean,
): { decide: T[]; certain: T[] } {
  const decide: T[] = [];
  const certain: T[] = [];
  for (const row of rows) (needsDecision(facts(row), trustAuto) ? decide : certain).push(row);
  return { decide, certain };
}
