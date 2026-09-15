import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, AI_MODEL } from "./client";
import { RevenuePlanExtractionSchema, type RevenuePlanExtraction } from "./schemas";

const SYSTEM_PROMPT = `Είστε βοηθός δημιουργίας εκτιμήσεων εσόδων φιλοξενίας/ξενοδοχείου. Ο χρήστης περιγράφει σε ελεύθερο κείμενο τους τύπους δωματίων, τιμές και πληρότητα -- εσείς παράγετε το πλήρες πλέγμα 12 μηνών x αριθμό ετών ανά τύπο δωματίου. Αν ο χρήστης δώσει μία τιμή/πληρότητα "συνολικά" ή "σταθερή", εφαρμόστε την σε όλους τους μήνες. Αν αναφέρει εποχικότητα (π.χ. "το καλοκαίρι πιο ακριβά"), αντικατοπτρίστε το λογικά στο πλέγμα. Αν δεν αναφερθεί αριθμός ετών, χρησιμοποιήστε 3. Αν δεν αναφερθεί έτος έναρξης, χρησιμοποιήστε το τρέχον έτος. ΠΟΤΕ μην υπολογίσετε διανυκτερεύσεις ή έσοδα -- μόνο occupancy_pct (0-1) και adr ανά μήνα. Στο assumptions_note εξηγήστε σύντομα στα Ελληνικά τι υποθέσατε.`;

export interface RevenuePlanExtractionResult {
  extraction: RevenuePlanExtraction;
  usage: { inputTokens: number; outputTokens: number; requestId: string };
}

export async function extractRevenuePlan(text: string, currentYear: number): Promise<RevenuePlanExtractionResult> {
  const response = await anthropic.messages.parse({
    model: AI_MODEL,
    max_tokens: 8192,
    system: `${SYSTEM_PROMPT}\n\nΤρέχον έτος: ${currentYear}.`,
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(RevenuePlanExtractionSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Η ανάλυση της περιγραφής απέτυχε (μη έγκυρη μορφή απάντησης).");
  }

  return {
    extraction: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      requestId: response.id,
    },
  };
}
