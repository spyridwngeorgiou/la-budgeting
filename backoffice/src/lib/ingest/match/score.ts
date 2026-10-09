import { toCents } from "@/lib/finance/money";
import type { TxDirection, TxStatus } from "@/lib/domain/enums";
import { nameTokens, normalizeGreek, type ExtractedRefs } from "../text";

// How well one incoming movement (a bank line, a cash entry) matches one
// existing transaction. Points, not probabilities: every point has a reason
// code the review panel shows as a chip, so a human can see *why* a match
// was proposed and overrule it.
//
//   exact amount 40 | partial (less than an open amount) 10
//   invoice no. / ΜΑΡΚ / RF / bank reference in the text 30
//   counterparty IBAN = contact IBAN 25
//   ΑΦΜ in the text = counterparty ΑΦΜ 20
//   name tokens up to 15 | date proximity up to 10 | installment due 5
//   ambiguity −15 (several exact-amount candidates, none with hard evidence)
//
// auto  >= 75 and >= 15 ahead of the next candidate (pre-selected, still reviewed)
// suggest >= 45 (shown, not selected) | below that: no match, "create".

export const POINTS = {
  amountExact: 40,
  amountPartial: 10,
  reference: 30,
  iban: 25,
  afm: 20,
  nameMax: 15,
  dateMax: 10,
  plan: 5,
  ambiguity: -15,
} as const;

export const THRESHOLDS = { auto: 75, autoGap: 15, suggest: 45 } as const;

export interface MatchCandidate {
  id: string;
  direction: TxDirection;
  status: TxStatus;
  grossAmount: number;
  txDate: string;
  dueDate: string | null;
  paidOn: string | null;
  accountId: string | null;
  invoiceNumber: string | null;
  mydataMark: string | null;
  bankReference: string | null;
  counterpartyAfm: string | null;
  counterpartyName: string | null;
  contactName: string | null;
  contactAfm: string | null;
  contactIban: string | null;
  contactAliases?: string[];
  planId: string | null;
  description: string | null;
  ingestRowId: string | null; // already linked to another bank line
}

export interface MatchMovement {
  direction: TxDirection | null;
  amount: number | null;
  txDate: string | null;
  valueDate?: string | null;
  description: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  extracted: ExtractedRefs;
}

export type ReasonCode =
  | "amount_exact"
  | "amount_partial"
  | "amount_sum"
  | "reference"
  | "iban"
  | "afm"
  | "name"
  | "date"
  | "plan"
  | "ambiguous";

export interface MatchReason {
  code: ReasonCode;
  points: number;
  detail?: string;
}

export type MatchKind = "single" | "partial" | "already_recorded";

export interface ScoredCandidate {
  candidate: MatchCandidate;
  kind: MatchKind;
  score: number;
  reasons: MatchReason[];
  // reference / IBAN / ΑΦΜ -- something an amount coincidence cannot fake
  hardEvidence: boolean;
}

export function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export function datePoints(days: number): number {
  if (days <= 3) return POINTS.dateMax;
  if (days <= 7) return 7;
  if (days <= 15) return 4;
  if (days <= 31) return 2;
  return 0;
}

// Letters and digits only: «ΤΔΑ/129», «ΤΔΑ 129» and «τδα-129» all compare equal.
function compact(s: string | null | undefined): string {
  return normalizeGreek(s).replace(/[^0-9A-ZΑ-Ω]/g, "");
}

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // Banks truncate names («ΠΑΠΑΔΟΠΟΥΛ»); accept a long-enough prefix.
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}

// Share of the candidate's name tokens found in the movement text, scaled
// to POINTS.nameMax. The best of counterparty name / contact name / aliases.
export function namePoints(movementText: string, names: (string | null | undefined)[]): number {
  const textTokens = nameTokens(movementText);
  if (textTokens.length === 0) return 0;
  let best = 0;
  for (const name of names) {
    const tokens = nameTokens(name);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => textTokens.some((x) => tokenMatch(t, x))).length;
    best = Math.max(best, hits / tokens.length);
  }
  return Math.round(POINTS.nameMax * best);
}

// The non-amount evidence alone (reference, IBAN, ΑΦΜ, name) -- shared with
// the one-payment-many-invoices search in assign.ts.
export function evidenceReasons(m: MatchMovement, c: MatchCandidate): MatchReason[] {
  const reasons: MatchReason[] = [];
  const text = [m.description, m.reference, m.counterpartyName].filter(Boolean).join(" ");
  const textCompact = compact(text);

  // The full number («ΤΔΑ129») anywhere in the compacted text, or its
  // digits («129», «0129») as a standalone number -- never as part of a
  // longer one, so invoice 129 does not match an amount of 1.290.
  const invoice = compact(c.invoiceNumber);
  const invoiceDigits = (c.invoiceNumber ?? "").match(/\d+/g)?.join("").replace(/^0+/, "") ?? "";
  const withoutAmounts = normalizeGreek(text).replace(/\d+(?:[.,]\d+)+/g, " ");
  const textNumbers = new Set((withoutAmounts.match(/\d+/g) ?? []).map((d) => d.replace(/^0+/, "")));
  const refHit =
    (invoice.length >= 5 && /\d/.test(invoice) && textCompact.includes(invoice)) ||
    (invoiceDigits.length >= 3 && textNumbers.has(invoiceDigits)) ||
    (!!c.mydataMark && m.extracted.marks.includes(c.mydataMark)) ||
    (!!c.bankReference &&
      (compact(c.bankReference) === compact(m.reference) || m.extracted.rfs.includes(compact(c.bankReference))));
  if (refHit) {
    reasons.push({ code: "reference", points: POINTS.reference, detail: c.invoiceNumber ?? c.mydataMark ?? c.bankReference ?? undefined });
  }

  const ibans = new Set([m.counterpartyIban, ...m.extracted.ibans].filter(Boolean).map((i) => compact(i)));
  if (c.contactIban && ibans.has(compact(c.contactIban))) {
    reasons.push({ code: "iban", points: POINTS.iban, detail: c.contactIban });
  }

  const afm = c.counterpartyAfm || c.contactAfm;
  if (afm && m.extracted.afms.includes(afm)) {
    reasons.push({ code: "afm", points: POINTS.afm, detail: afm });
  }

  const name = namePoints(text, [c.counterpartyName, c.contactName, ...(c.contactAliases ?? [])]);
  if (name > 0) reasons.push({ code: "name", points: name });
  return reasons;
}

// null = cannot be this movement at all (wrong direction, cancelled, an
// amount that no decision could reconcile, or already claimed by a line).
export function scoreCandidate(m: MatchMovement, c: MatchCandidate): ScoredCandidate | null {
  if (!m.direction || m.amount === null || m.amount <= 0 || !m.txDate) return null;
  if (c.direction !== m.direction || c.status === "cancelled") return null;

  const amount = toCents(m.amount);
  const gross = toCents(c.grossAmount);
  const reasons: MatchReason[] = [];
  let kind: MatchKind;

  if (c.status === "paid") {
    // "Already recorded": someone entered the payment by hand before the
    // statement arrived. Only an exact amount, near the payment date, on a
    // row no other bank line has claimed.
    if (c.ingestRowId || amount !== gross) return null;
    if (daysBetween(m.txDate, c.paidOn ?? c.txDate) > 10) return null;
    kind = "already_recorded";
    reasons.push({ code: "amount_exact", points: POINTS.amountExact });
  } else if (amount === gross) {
    kind = "single";
    reasons.push({ code: "amount_exact", points: POINTS.amountExact });
  } else if (amount < gross) {
    kind = "partial";
    reasons.push({ code: "amount_partial", points: POINTS.amountPartial });
  } else {
    return null; // more than is owed: never a settle of this one row
  }

  reasons.push(...evidenceReasons(m, c));

  const anchor = kind === "already_recorded" ? (c.paidOn ?? c.txDate) : (c.dueDate ?? c.txDate);
  const days = daysBetween(m.txDate, anchor);
  const date = datePoints(days);
  if (date > 0) reasons.push({ code: "date", points: date, detail: `${days} ημ.` });
  if (c.planId && kind !== "already_recorded" && days <= 7) reasons.push({ code: "plan", points: POINTS.plan });

  const hardEvidence = reasons.some((r) => r.code === "reference" || r.code === "iban" || r.code === "afm");
  const score = reasons.reduce((s, r) => s + r.points, 0);
  return { candidate: c, kind, score, reasons, hardEvidence };
}

// All viable candidates for one movement, best first, with the ambiguity
// penalty applied: when several candidates match on amount alone, none of
// them deserves an automatic pick.
export function rankCandidates(m: MatchMovement, candidates: MatchCandidate[]): ScoredCandidate[] {
  const scored = candidates.map((c) => scoreCandidate(m, c)).filter((s): s is ScoredCandidate => s !== null);
  const exact = scored.filter((s) => s.kind !== "partial");
  if (exact.length >= 2) {
    for (const s of exact) {
      if (!s.hardEvidence) {
        s.reasons.push({ code: "ambiguous", points: POINTS.ambiguity });
        s.score += POINTS.ambiguity;
      }
    }
  }
  return scored.sort((a, b) => b.score - a.score || a.candidate.txDate.localeCompare(b.candidate.txDate));
}

export type Confidence = "auto" | "suggest" | "none";

export function confidenceOf(score: number, runnerUp: number | null): Confidence {
  if (score >= THRESHOLDS.auto && (runnerUp === null || score - runnerUp >= THRESHOLDS.autoGap)) return "auto";
  if (score >= THRESHOLDS.suggest) return "suggest";
  return "none";
}
