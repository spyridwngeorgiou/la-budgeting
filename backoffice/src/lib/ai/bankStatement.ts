import "server-only";
import { anthropic, EXTRACTION_MODEL, EXTRACTION_MODEL_FALLBACK, isModelNotFoundError } from "./client";
import { bankStatementRequest, type BankStatementExtraction } from "./bankStatementRequest";
import type { ExtractionResult } from "./extract";
import { UserError } from "@/lib/actions";

// One PDF statement -> its transcribed header and rows. Network-bound (the
// Worker only waits); the CPU-side work is the pure mapping in
// lib/ingest/adapters/bankPdf.ts.

export interface BankStatementResult {
  extraction: BankStatementExtraction;
  usage: ExtractionResult["usage"];
}

// A multi-page statement takes longer than a receipt.
const TIMEOUT_MS = 300_000;

export async function extractBankStatement(base64Data: string): Promise<BankStatementResult> {
  const params = bankStatementRequest({ base64Data });
  let response;
  try {
    response = await anthropic.beta.messages.parse(params, { timeout: TIMEOUT_MS });
  } catch (error) {
    if (params.model !== EXTRACTION_MODEL || !isModelNotFoundError(error)) throw error;
    response = await anthropic.beta.messages.parse({ ...params, model: EXTRACTION_MODEL_FALLBACK }, { timeout: TIMEOUT_MS });
  }
  if (response.stop_reason === "refusal") {
    throw new UserError("Το μοντέλο αρνήθηκε να διαβάσει αυτό το αντίγραφο. Ανεβάστε το σε CSV/XLSX αν η τράπεζα το δίνει.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new UserError("Το αντίγραφο είναι πολύ μεγάλο για μία ανάγνωση — κατεβάστε μικρότερη περίοδο και ξαναδοκιμάστε.");
  }
  if (!response.parsed_output) {
    throw new UserError("Η ανάγνωση του αντιγράφου απέτυχε (μη έγκυρη μορφή απάντησης).");
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
