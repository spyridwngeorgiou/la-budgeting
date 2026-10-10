import type { Extraction, NlEntry } from "@/lib/ai/schemas";
import { cashOnly, deriveFromGross, deriveFromNet } from "@/lib/finance/money";
import { isIsoDate } from "@/lib/dates";
import type { StageRow } from "../stage";

// The pure half of the three AI capture adapters (aiDocument, aiText,
// aiEmail): what the model read -> one staged document row. The server half
// (calling the model, resolving entities, logging usage) is in aiCapture.ts.
//
// Same invariant as 0010's transaction_drafts: the model's output is only
// ever a proposal. Rows stage with decision 'pending', so nothing reaches the
// ledger until a person has looked at the row and chosen «Νέα κίνηση».

export const AI_DOCUMENT_MODEL = "claude-opus-5";
export const AI_TEXT_MODEL = "claude-haiku-4-5";

export interface AiProposal {
  contactId: string | null;
  projectId: string | null;
  categoryId: string | null;
  contactMatchStrength: "afm" | "name" | "none";
  direction?: "income" | "expense";
}

// What ingest_rows.meta.ai holds for an AI-captured row.
export interface AiRowMeta {
  model: string;
  proposal: AiProposal;
  needs_review_reasons: string[];
  draft_id?: string | null; // set by the 0072 backfill
}

// Digits only, like the AADE importer's cleanId: a ΜΑΡΚ typed or read with
// spaces must still collide with the same ΜΑΡΚ on tx_mark_uq.
export function cleanMark(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits || null;
}

// A text/voice entry in the same shape as a photo extraction, so review and
// corrections need no special case: people state what they handed over
// (gross), net/VAT are backed out server-side, the phrase is the evidence.
export function nlEntryToExtraction(entry: NlEntry, text: string, label: string, today: string): Extraction {
  const amount = entry.amount.value ?? 0;
  const breakdown = entry.has_invoice ? deriveFromGross(amount, entry.vat_rate ?? 0.24) : cashOnly(amount);
  return {
    doc_type: "other",
    issuer_name: entry.counterparty_name,
    issuer_afm: null,
    invoice_number: null,
    mydata_mark: null,
    issue_date: entry.issue_date ?? today,
    net: { value: breakdown.net, evidence: entry.amount.evidence },
    vat: { value: breakdown.vat, evidence: entry.amount.evidence },
    gross: { value: breakdown.gross, evidence: entry.amount.evidence },
    vat_rate: entry.vat_rate,
    withholding: { value: 0, evidence: null },
    payment_hint: "unknown",
    project_mention: entry.project_mention,
    supply_number: null,
    suggested_category: entry.suggested_category,
    notes_for_human: [entry.notes_for_human, `${label}: «${text}»`].filter(Boolean).join(" · "),
  };
}

export const NO_CONTACT_REASON = "Δεν βρέθηκε αντίστοιχη επαφή -- επιλέξτε ή δημιουργήστε.";
export const NO_PROJECT_REASON = "Δεν βρέθηκε αντίστοιχο έργο -- επιλέξτε.";

export function needsReviewReasons(validationReasons: string[], proposal: AiProposal): string[] {
  const reasons = [...validationReasons];
  if (!proposal.contactId) reasons.push(NO_CONTACT_REASON);
  if (!proposal.projectId) reasons.push(NO_PROJECT_REASON);
  return reasons;
}

// The defaults the old review form (documents/[id]/review/ReviewForm.tsx)
// opened with: «Με παραστατικό» ticked when the model read any VAT, net =
// the read net (or the total), VAT rate 24% unless read, and the total
// derived from those -- so a staged row is internally consistent and its
// AI-read originals stay in `raw` for the corrections diff.
export function aiExtractionToStageRow(input: {
  rowNo: number;
  extraction: Extraction;
  proposal: AiProposal;
  needsReview: string[];
  model: string;
  documentId: string | null;
  today: string;
}): StageRow {
  const { extraction: e, proposal } = input;
  const hasInvoice = (e.vat.value ?? 0) > 0;
  const netInput = e.net.value ?? e.gross.value ?? 0;
  const rate = e.vat_rate ?? 0.24;
  const breakdown = hasInvoice ? deriveFromNet(netInput, rate, e.withholding.value ?? 0) : cashOnly(netInput);
  const parseErrors: string[] = [];
  const amountOk = breakdown.gross > 0 && breakdown.net >= 0 && breakdown.vat >= 0 && breakdown.withholding >= 0;
  if (!amountOk) parseErrors.push("Δεν διαβάστηκε θετικό ποσό — συμπληρώστε το.");
  const txDate = isIsoDate(e.issue_date) ? e.issue_date : input.today;
  const afm = e.issuer_afm?.replace(/\D/g, "") || null;
  const mark = cleanMark(e.mydata_mark);
  const meta: AiRowMeta = { model: input.model, proposal, needs_review_reasons: input.needsReview };
  return {
    rowNo: input.rowNo,
    kind: "document",
    raw: e as unknown as Record<string, unknown>,
    extracted: { afms: afm ? [afm] : [], ibans: [], rfs: [], marks: mark ? [mark] : [] },
    externalKey: null,
    txDate,
    valueDate: null,
    direction: proposal.direction ?? "expense",
    amount: amountOk ? breakdown.gross : null,
    netAmount: amountOk ? breakdown.net : null,
    vatAmount: amountOk ? breakdown.vat : null,
    vatRate: hasInvoice ? rate : null,
    withholdingAmount: amountOk ? breakdown.withholding : null,
    hasInvoice,
    description: null,
    counterpartyName: e.issuer_name,
    counterpartyAfm: afm,
    counterpartyIban: null,
    reference: null,
    invoiceNumber: e.invoice_number,
    mydataMark: mark,
    balanceAfter: null,
    parseErrors,
    documentId: input.documentId,
    contactId: proposal.contactId,
    projectId: proposal.projectId,
    categoryId: proposal.categoryId,
    decision: "pending",
    meta: { ai: meta },
  };
}

// The learning-loop diff approveDraft wrote to ai_corrections: one entry per
// field where the model read something and the committed row says otherwise.
export function aiCorrections(row: {
  raw: unknown;
  net_amount: number | null;
  vat_amount: number | null;
  tx_date: string | null;
  mydata_mark: string | null;
  counterparty_afm: string | null;
}): { field: string; ai_value: string | number; human_value: string | number | null }[] {
  const e = (row.raw ?? {}) as Partial<Extraction>;
  const out: { field: string; ai_value: string | number; human_value: string | number | null }[] = [];
  const compare = (field: string, ai: string | number | null | undefined, human: string | number | null | undefined) => {
    if (ai != null && String(ai) !== String(human)) out.push({ field, ai_value: ai, human_value: human ?? null });
  };
  compare("net_amount", e.net?.value, row.net_amount == null ? null : Number(row.net_amount));
  compare("vat_amount", e.vat?.value, row.vat_amount == null ? null : Number(row.vat_amount));
  compare("issue_date", e.issue_date, row.tx_date);
  compare("mydata_mark", cleanMark(e.mydata_mark), row.mydata_mark);
  compare("issuer_afm", e.issuer_afm, row.counterparty_afm);
  return out;
}

export function aiModelFor(source: string): string {
  return source === "ai_nl" ? AI_TEXT_MODEL : AI_DOCUMENT_MODEL;
}
