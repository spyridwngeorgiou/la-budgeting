import { toCents } from "@/lib/finance/money";
import type { IngestDecision } from "../types";
import {
  POINTS,
  THRESHOLDS,
  confidenceOf,
  daysBetween,
  datePoints,
  evidenceReasons,
  rankCandidates,
  type Confidence,
  type MatchCandidate,
  type MatchMovement,
  type MatchReason,
  type ScoredCandidate,
} from "./score";

// Whole-statement assignment, in order of how much a match can be trusted:
//   1. exact one-to-one (settle / already recorded): greedy, best score
//      first across the statement, each transaction claimed at most once --
//      so a strong match elsewhere is not stolen by a weaker one that
//      happened to be earlier in the file;
//   2. one payment exactly covering several open invoices (subset-sum, <= 5)
//      -- before partials, or the first invoice of the set would be
//      "partially paid" by a payment that settles all of them;
//   3. partial payment of one larger open amount (greedy again);
//   4. everything left becomes "create".
//
// Output is a proposal: nothing here writes to the ledger. The review screen
// shows it, a human confirms, commit_ingest_batch applies it.

export const MAX_SUBSET = 5;
const SUBSET_POOL = 15;

export interface ProposedMatch {
  kind: "single" | "partial" | "many" | "already_recorded";
  transactionIds: string[];
  score: number;
  reasons: MatchReason[];
}

export interface Assignment {
  decision: IngestDecision;
  targets: string[];
  confidence: Confidence;
  score: number;
  reasons: MatchReason[];
  // Ranked alternatives for the side panel (the chosen one first, if any).
  matches: ProposedMatch[];
}

const DECISION_BY_KIND: Record<ScoredCandidate["kind"], IngestDecision> = {
  single: "settle",
  partial: "settle_partial",
  already_recorded: "link_existing",
};

function toProposed(s: ScoredCandidate): ProposedMatch {
  return { kind: s.kind, transactionIds: [s.candidate.id], score: s.score, reasons: s.reasons };
}

// Exact-cent subset of `items` summing to `target`, 2..MAX_SUBSET members.
// Depth-first over amounts sorted descending with remaining-sum pruning;
// `pool` is already capped, so the search stays small. Returns every
// solution so the caller can prefer the best-evidenced one.
export function subsetsSummingTo(amounts: number[], target: number, maxSize = MAX_SUBSET): number[][] {
  const items = amounts.map((a, i) => ({ cents: toCents(a), i })).sort((x, y) => y.cents - x.cents);
  const goal = toCents(target);
  const suffix: number[] = new Array(items.length + 1).fill(0);
  for (let k = items.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + items[k].cents;
  const out: number[][] = [];
  const pick: number[] = [];
  const walk = (start: number, sum: number) => {
    if (out.length >= 50) return;
    if (sum === goal && pick.length >= 2) {
      out.push(pick.map((k) => items[k].i));
      return;
    }
    if (pick.length === maxSize || sum + suffix[start] < goal) return;
    for (let k = start; k < items.length; k++) {
      if (sum + items[k].cents > goal) continue;
      pick.push(k);
      walk(k + 1, sum + items[k].cents);
      pick.pop();
    }
  };
  walk(0, 0);
  return out;
}

export function assignMatches(movements: MatchMovement[], candidates: MatchCandidate[]): Assignment[] {
  const ranked = movements.map((m) => rankCandidates(m, candidates));
  const result: (Assignment | null)[] = movements.map(() => null);
  const claimed = new Set<string>();

  const greedy = (partial: boolean) => {
    const pairs = ranked
      .flatMap((list, mi) => list.map((s, rank) => ({ mi, s, rank })))
      .filter((p) => (p.s.kind === "partial") === partial && p.s.score >= THRESHOLDS.suggest)
      .sort((a, b) => b.s.score - a.s.score || a.mi - b.mi);
    for (const { mi, s, rank } of pairs) {
      if (result[mi] || claimed.has(s.candidate.id)) continue;
      claimed.add(s.candidate.id);
      const others = ranked[mi].filter((o) => o !== s);
      // Auto only for the movement's own best candidate, clear of the
      // runner-up -- and never for a partial payment.
      const confidence = rank === 0 && !partial ? confidenceOf(s.score, others[0]?.score ?? null) : "suggest";
      result[mi] = {
        decision: DECISION_BY_KIND[s.kind],
        targets: [s.candidate.id],
        confidence: confidence === "none" ? "suggest" : confidence,
        score: s.score,
        reasons: s.reasons,
        matches: [s, ...others].slice(0, 5).map(toProposed),
      };
    }
  };

  // 1. Exact one-to-one.
  greedy(false);

  // 2. One payment, several open invoices of the same counterparty.
  movements.forEach((m, mi) => {
    if (result[mi] || !m.direction || m.amount === null || !m.txDate) return;
    const pool = candidates
      .filter(
        (c) =>
          !claimed.has(c.id) &&
          c.direction === m.direction &&
          (c.status === "pending" || c.status === "scheduled") &&
          toCents(c.grossAmount) < toCents(m.amount!),
      )
      .map((c) => {
        const reasons = evidenceReasons(m, c);
        return { c, reasons, evidence: reasons.reduce((s, r) => s + r.points, 0) };
      })
      // Same-counterparty evidence required: summing strangers' invoices to
      // a round number is a coincidence, not a match.
      .filter((x) => x.evidence >= 10)
      .sort((a, b) => b.evidence - a.evidence)
      .slice(0, SUBSET_POOL);
    if (pool.length < 2) return;

    const solutions = subsetsSummingTo(pool.map((x) => x.c.grossAmount), m.amount);
    if (solutions.length === 0) return;
    const best = solutions
      .map((idx) => {
        const members = idx.map((i) => pool[i]);
        const evidence = Math.round(members.reduce((s, x) => s + x.evidence, 0) / members.length);
        const days = Math.max(...members.map((x) => daysBetween(m.txDate!, x.c.dueDate ?? x.c.txDate)));
        return { members, evidence, date: datePoints(days), size: members.length };
      })
      .sort((a, b) => b.evidence + b.date - (a.evidence + a.date) || a.size - b.size)[0];

    const reasons: MatchReason[] = [
      { code: "amount_sum", points: POINTS.amountExact, detail: `${best.size} κινήσεις` },
      ...mergeEvidence(best.members.map((x) => x.reasons), best.evidence),
    ];
    if (best.date > 0) reasons.push({ code: "date", points: best.date });
    const score = reasons.reduce((s, r) => s + r.points, 0);
    best.members.forEach((x) => claimed.add(x.c.id));
    const many: ProposedMatch = {
      kind: "many",
      transactionIds: best.members.map((x) => x.c.id),
      score,
      reasons,
    };
    result[mi] = {
      decision: "settle_many",
      targets: many.transactionIds,
      // Never automatic: a sum can coincide even within one counterparty.
      confidence: score >= THRESHOLDS.suggest ? "suggest" : "none",
      score,
      reasons,
      matches: [many, ...ranked[mi].slice(0, 4).map(toProposed)],
    };
  });

  // 3. Partial payment of one open amount.
  greedy(true);

  // 4. No match: a new transaction, with whatever came close as alternatives.
  return result.map(
    (a, mi) =>
      a ?? {
        decision: "create",
        targets: [],
        confidence: "none",
        score: 0,
        reasons: [],
        matches: ranked[mi].slice(0, 5).map(toProposed),
      },
  );
}

// One reason per code across the members, carrying the average evidence so
// the chips on a many-match read like those on a single one.
function mergeEvidence(lists: MatchReason[][], averagePoints: number): MatchReason[] {
  const codes = [...new Set(lists.flat().map((r) => r.code))];
  if (codes.length === 0) return [];
  const total = lists.flat().reduce((s, r) => s + r.points, 0) || 1;
  return codes.map((code) => {
    const share = lists.flat().filter((r) => r.code === code).reduce((s, r) => s + r.points, 0) / total;
    return { code, points: Math.round(averagePoints * share) };
  });
}
