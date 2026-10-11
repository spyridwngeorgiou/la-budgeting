// «Χρειάζεται Προσοχή» on the dashboard: every pending signal, ranked by how
// much it can hurt, capped to the few that fit at a glance. The rest is
// counted («+N ακόμα»), never silently dropped.

// Most severe first. Kinds not named by the owner's order (uncounted
// accounts, contactless counterparties, missing project/account) come last.
export const ATTENTION_ORDER = [
  "cashBelowBuffer",
  "overdue",
  "inbox",
  "vatUnfiled",
  "accountDrift",
  "overBudget",
  "uninvoiced",
  "uncountedAccounts",
  "contactless",
  "missingProjectOrAccount",
] as const;

export type AttentionKind = (typeof ATTENTION_ORDER)[number];

export type AttentionItem = { kind: AttentionKind; label: string; href: string };

export const ATTENTION_MAX = 3;

// Falsy entries (a check with nothing to report) are dropped; ties keep
// their input order, so several drifting accounts stay in the order given.
export function rankAttention(
  items: (AttentionItem | false | null | undefined)[],
  max = ATTENTION_MAX,
): { shown: AttentionItem[]; more: number } {
  const rank = (k: AttentionKind) => ATTENTION_ORDER.indexOf(k);
  const all = items
    .filter((x): x is AttentionItem => Boolean(x))
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.kind) - rank(b.item.kind) || a.i - b.i)
    .map((x) => x.item);
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}
