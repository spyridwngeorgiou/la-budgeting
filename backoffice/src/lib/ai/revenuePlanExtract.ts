import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  anthropic,
  EXTRACTION_EFFORT,
  EXTRACTION_MODEL,
  EXTRACTION_MODEL_FALLBACK,
  isModelNotFoundError,
  REFUSAL_FALLBACK_BETA,
} from "./client";
import { RevenuePlanExtractionSchema, type RevenuePlanExtraction } from "./schemas";
import { UserError } from "@/lib/actions";

const SYSTEM_PROMPT = `Είστε βοηθός δημιουργίας εκτιμήσεων εσόδων φιλοξενίας/ξενοδοχείου. Ο χρήστης περιγράφει σε ελεύθερο κείμενο τους τύπους δωματίων, τιμές και πληρότητα -- εσείς παράγετε το πλήρες πλέγμα 12 μηνών x αριθμό ετών ανά τύπο δωματίου. Αν ο χρήστης δώσει μία τιμή/πληρότητα "συνολικά" ή "σταθερή", εφαρμόστε την σε όλους τους μήνες. Αν αναφέρει εποχικότητα (π.χ. "το καλοκαίρι πιο ακριβά"), αντικατοπτρίστε το λογικά στο πλέγμα. Αν δεν αναφερθεί αριθμός ετών, χρησιμοποιήστε 3. Αν δεν αναφερθεί έτος έναρξης, χρησιμοποιήστε το τρέχον έτος. ΠΟΤΕ μην υπολογίσετε διανυκτερεύσεις ή έσοδα -- μόνο occupancy_pct (0-1) και adr ανά μήνα. Στο assumptions_note εξηγήστε σύντομα στα Ελληνικά τι υποθέσατε.`;

export interface RevenuePlanExtractionResult {
  extraction: RevenuePlanExtraction;
  // model: the one that actually served the call (fallbacks may differ).
  usage: { inputTokens: number; outputTokens: number; requestId: string; model: string };
}

export async function extractRevenuePlan(text: string, currentYear: number): Promise<RevenuePlanExtractionResult> {
  // Structured outputs, not forced tool use (Sonnet 5.5 rejects tool_choice
  // any/tool). Thinking stays adaptive; max_tokens covers thinking + the grid.
  const params = {
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    system: `${SYSTEM_PROMPT}

Τρέχον έτος: ${currentYear}.`,
    messages: [{ role: "user" as const, content: text }],
    output_config: { format: betaZodOutputFormat(RevenuePlanExtractionSchema), effort: EXTRACTION_EFFORT },
    betas: [REFUSAL_FALLBACK_BETA],
    fallbacks: "default" as const,
  };
  let response;
  try {
    response = await anthropic.beta.messages.parse(params);
  } catch (error) {
    if (!isModelNotFoundError(error)) throw error;
    response = await anthropic.beta.messages.parse({ ...params, model: EXTRACTION_MODEL_FALLBACK });
  }

  if (response.stop_reason === "refusal") {
    throw new UserError("Το μοντέλο αρνήθηκε να επεξεργαστεί αυτή την περιγραφή.");
  }
  if (!response.parsed_output) {
    throw new UserError("Η ανάλυση της περιγραφής απέτυχε (μη έγκυρη μορφή απάντησης).");
  }

  return {
    extraction: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      requestId: response.id,
      model: response.model || params.model,
    },
  };
}
