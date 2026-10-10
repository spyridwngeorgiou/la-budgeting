import "server-only";
import { anthropic, EXTRACTION_MODEL, EXTRACTION_MODEL_FALLBACK, isModelNotFoundError } from "./client";
import { extractionRequest, type ExtractionEffort } from "./extractRequest";
import { type Extraction } from "./schemas";
import { isValidAfm } from "@/lib/finance/money";
import { UserError } from "@/lib/actions";

export interface ExtractionResult {
  extraction: Extraction;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    requestId: string;
    // The model that actually served the call (a refusal fallback or the
    // model-not-found fallback may differ from EXTRACTION_MODEL) -- this is
    // what document_jobs / ai_usage record.
    model: string;
  };
}

export interface ExtractOptions {
  // Eval-only overrides; production always uses the defaults.
  model?: string;
  effort?: ExtractionEffort | null;
}

export async function extractDocument(
  base64Data: string,
  mediaType: string,
  categoryNames: string[],
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const params = extractionRequest({ base64Data, mediaType, categoryNames, ...options });
  let response;
  try {
    response = await anthropic.beta.messages.parse(params);
  } catch (error) {
    // Only a retired/renamed id falls back; rate limits and 5xx are already
    // retried by the SDK and would fail the same way on another model.
    if (params.model !== EXTRACTION_MODEL || !isModelNotFoundError(error)) throw error;
    response = await anthropic.beta.messages.parse({ ...params, model: EXTRACTION_MODEL_FALLBACK });
  }

  if (response.stop_reason === "refusal") {
    throw new UserError("Το μοντέλο αρνήθηκε να αναλύσει αυτό το παραστατικό. Καταχωρήστε το χειροκίνητα.");
  }
  if (!response.parsed_output) {
    throw new UserError("Η ανάλυση του παραστατικού απέτυχε (μη έγκυρη μορφή απάντησης).");
  }

  return {
    extraction: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      requestId: response.id,
      model: response.model || params.model,
    },
  };
}

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

// Deterministic checks, always run server-side regardless of the model's own
// confidence claims. isValidAfm is the Greek mod-11 checksum -- catches an
// OCR digit error on the single most important key in the system, for free.
export function validateExtraction(e: Extraction): ValidationResult {
  const reasons: string[] = [];

  if (e.issuer_afm && !isValidAfm(e.issuer_afm)) {
    reasons.push("Το ΑΦΜ δεν περνάει τον έλεγχο ψηφίου ελέγχου -- πιθανό λάθος ανάγνωσης.");
  }

  if (e.net.value != null && e.vat.value != null && e.gross.value != null) {
    const expected = Math.round((e.net.value + e.vat.value - (e.withholding.value ?? 0)) * 100) / 100;
    if (Math.abs(expected - e.gross.value) > 0.02) {
      reasons.push(`Καθαρή + ΦΠΑ − Παρακράτηση (${expected}) δεν ταιριάζει με το Σύνολο (${e.gross.value}).`);
    }
  }

  if (e.vat_rate != null && e.net.value != null && e.vat.value != null) {
    const expectedVat = Math.round(e.net.value * e.vat_rate * 100) / 100;
    if (Math.abs(expectedVat - e.vat.value) > 0.02) {
      reasons.push(`ΦΠΑ (${e.vat.value}) δεν ταιριάζει με ${e.vat_rate * 100}% × καθαρή αξία.`);
    }
  }

  if (e.issue_date) {
    const d = new Date(e.issue_date);
    const now = new Date();
    const twoDaysAhead = new Date(now.getTime() + 2 * 86400000);
    const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    if (Number.isNaN(d.getTime())) reasons.push("Μη έγκυρη ημερομηνία.");
    else if (d > twoDaysAhead) reasons.push("Η ημερομηνία είναι στο μέλλον.");
    else if (d < fiveYearsAgo) reasons.push("Η ημερομηνία είναι ασυνήθιστα παλιά.");
  } else {
    reasons.push("Δεν βρέθηκε ημερομηνία.");
  }

  if (e.gross.value == null) reasons.push("Δεν βρέθηκε συνολικό ποσό.");

  return { ok: reasons.length === 0, reasons };
}
