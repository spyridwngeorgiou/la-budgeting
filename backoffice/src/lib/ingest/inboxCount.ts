// The «Εισερχόμενα» badge: everything waiting for a person in one number --
// rows to review in staged batches, Kansha AI changes to approve, and AI
// proposals on the project canvases. Pure, so vitest covers it; the three
// counts come from lib/data/inboxCount.ts.
export interface InboxCounts {
  rows: number;
  changes: number;
  proposals: number;
}

export function inboxTotal(counts: Partial<InboxCounts> | null | undefined): number {
  if (!counts) return 0;
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return n(counts.rows) + n(counts.changes) + n(counts.proposals);
}
