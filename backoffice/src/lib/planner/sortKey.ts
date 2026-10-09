// Kanban ordering by fractional sort keys (tasks.sort_key, double).
//
// Moving a card writes ONE row: its new key is the midpoint of the two
// neighbours it was dropped between. Halving a gap ~50 times exhausts a
// double's precision, so once a gap gets too small to split safely the
// whole column is renumbered at even STEP spacing -- rare, and still only
// the one column.

export const SORT_STEP = 1024;
// Far above double epsilon at these magnitudes, so a midpoint between two
// keys this close is still distinct from both.
export const MIN_GAP = 1e-6;

export interface Keyed {
  id: string;
  sort_key: number;
}

// A key strictly between `before` and `after` (either may be absent: the
// card goes to the top, the bottom, or an empty column).
export function keyBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return SORT_STEP;
  if (before == null) return (after as number) - SORT_STEP;
  if (after == null) return before + SORT_STEP;
  return (before + after) / 2;
}

export function rebalance(ids: string[]): Keyed[] {
  return ids.map((id, i) => ({ id, sort_key: (i + 1) * SORT_STEP }));
}

export interface MovePlan {
  // The moved card's new key.
  sortKey: number;
  // Present only when the column had to be renumbered: every row in it
  // (moved card included) with its new key.
  rebalanced?: Keyed[];
}

// `column` is the destination column in display order AFTER the drop, with
// the moved card at its new position. Keys of the other cards are their
// current stored keys; the moved card's own key is ignored.
export function planMove(column: Keyed[], movedId: string): MovePlan {
  const index = column.findIndex((c) => c.id === movedId);
  if (index === -1) throw new Error(`planMove: ${movedId} not in column`);
  const before = index > 0 ? column[index - 1].sort_key : null;
  const after = index < column.length - 1 ? column[index + 1].sort_key : null;

  const tooTight =
    (before != null && after != null && after - before < MIN_GAP) ||
    // Neighbours stored out of order (concurrent moves): no midpoint exists.
    (before != null && after != null && after <= before);
  if (tooTight) {
    const rebalanced = rebalance(column.map((c) => c.id));
    return { sortKey: rebalanced[index].sort_key, rebalanced };
  }
  return { sortKey: keyBetween(before, after) };
}

// The key for appending to the end of a column (new task, «Μετακίνηση σε…»).
export function keyAtEnd(column: Keyed[]): number {
  if (column.length === 0) return SORT_STEP;
  return keyBetween(Math.max(...column.map((c) => c.sort_key)), null);
}
