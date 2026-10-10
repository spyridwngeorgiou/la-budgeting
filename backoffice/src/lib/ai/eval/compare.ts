import type { Extraction } from "@/lib/ai/schemas";
import { priceFor } from "@/lib/ai/usage";

// Pure half of the extraction eval (extraction.eval.ts): normalise the key
// fields two models read off the same document and say whether they agree.
// Agreement, not accuracy -- there is no hand-labelled truth; a disagreement
// is a document to look at.

export const KEY_FIELDS = ["issuer_afm", "issue_date", "gross", "net", "vat", "mydata_mark", "doc_type"] as const;
export type KeyField = (typeof KEY_FIELDS)[number];
export type Normalised = Record<KeyField, string | null>;

const digits = (v: string | null | undefined) => v?.replace(/\D/g, "") || null;

function money(v: number | null | undefined): string | null {
  return v == null || !Number.isFinite(v) ? null : (Math.round(v * 100) / 100).toFixed(2);
}

// ISO first; tolerate a model writing DD/MM/YYYY (Greek order) anyway.
export function normDate(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const gr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (gr) {
    const y = gr[3].length === 2 ? `20${gr[3]}` : gr[3];
    return `${y}-${gr[2].padStart(2, "0")}-${gr[1].padStart(2, "0")}`;
  }
  return s;
}

export function normalise(e: Extraction): Normalised {
  return {
    // AFM is 9 digits; strip an "EL" VAT prefix, spaces, dots.
    issuer_afm: digits(e.issuer_afm),
    issue_date: normDate(e.issue_date),
    gross: money(e.gross?.value),
    net: money(e.net?.value),
    vat: money(e.vat?.value),
    mydata_mark: digits(e.mydata_mark),
    doc_type: e.doc_type?.trim().toLowerCase() || null,
  };
}

export type FieldAgreement = Record<KeyField, boolean>;

// Both null counts as agreement (neither model saw the field).
export function compareExtractions(a: Extraction, b: Extraction): FieldAgreement {
  const na = normalise(a);
  const nb = normalise(b);
  return Object.fromEntries(KEY_FIELDS.map((f) => [f, na[f] === nb[f]])) as FieldAgreement;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function costUsd(model: string, u: CallUsage): number {
  const p = priceFor(model);
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      (u.cacheReadTokens ?? 0) * p.cacheRead +
      (u.cacheWriteTokens ?? 0) * p.cacheWrite) /
    100 /
    1_000_000
  );
}

// Pre-run estimate: input from count_tokens, output assumed (thinking + JSON).
export function estimateCallUsd(model: string, inputTokens: number, assumedOutputTokens: number): number {
  return costUsd(model, { inputTokens, outputTokens: assumedOutputTokens });
}

export function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
