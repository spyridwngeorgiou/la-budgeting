import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, AI_MODEL_FAST } from "./client";
import { NlExtractionSchema, type NlEntry } from "./schemas";

const SYSTEM_PROMPT = `Είστε βοηθός καταχώρησης οικονομικών κινήσεων μιας ελληνικής επιχείρησης ακινήτων/κατασκευών. Ο χρήστης περιγράφει μία Ή ΠΕΡΙΣΣΟΤΕΡΕΣ κινήσεις στα Ελληνικά, γραπτά ή απομαγνητοφωνημένη από φωνή -- εξάγετε τα δομημένα στοιχεία.

ΚΑΝΟΝΕΣ:
- Αν το κείμενο περιγράφει πάνω από μία κίνηση (π.χ. "50 στον υδραυλικό, 30 για βενζίνη, και πήρα 200 από τον Παπαδόπουλο"), δημιουργήστε ΞΕΧΩΡΙΣΤΗ εγγραφή στο "entries" για ΚΑΘΕ κίνηση -- ποτέ μην αθροίζετε ή συγχωνεύετε ποσά/αντισυμβαλλόμενους/έργα διαφορετικών κινήσεων σε μία εγγραφή.
- Κάθε εγγραφή έχει τα ΔΙΚΑ ΤΗΣ counterparty_name, project_mention, category -- μην επαναχρησιμοποιείτε στοιχεία από άλλη κίνηση εκτός αν ρητά αναφέρεται ότι ισχύουν και για αυτήν (π.χ. "και τα δύο για το Q003").
- Ποτέ μην υπολογίζετε ή μαντεύετε το ποσό -- αν δεν αναφέρεται ρητά αριθμός για μια κίνηση, βάλτε value: null σε αυτή την εγγραφή. Στο "evidence" γράψτε την ακριβή φράση που περιέχει το ποσό.
- Αν το κείμενο περιγράφει μία μόνο κίνηση, επιστρέψτε ένα "entries" με ένα μόνο στοιχείο.`;

export interface NlExtractionResult {
  entries: NlEntry[];
  usage: { inputTokens: number; outputTokens: number; requestId: string };
}

export async function extractFromText(text: string, categoryNames: string[]): Promise<NlExtractionResult> {
  const response = await anthropic.messages.parse({
    model: AI_MODEL_FAST,
    max_tokens: 1024,
    system: `${SYSTEM_PROMPT}\n\nΔιαθέσιμες κατηγορίες (χρησιμοποιήστε ακριβώς ένα από αυτά τα ονόματα στο suggested_category, ή null): ${categoryNames.join(", ")}`,
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(NlExtractionSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Η ανάλυση του κειμένου απέτυχε (μη έγκυρη μορφή απάντησης).");
  }

  return {
    entries: response.parsed_output.entries,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      requestId: response.id,
    },
  };
}

export interface NlValidationResult {
  ok: boolean;
  reasons: string[];
}

export function validateNlExtraction(e: NlEntry): NlValidationResult {
  const reasons: string[] = [];
  if (e.amount.value == null) reasons.push("Δεν βρέθηκε ποσό στην περιγραφή.");
  else if (e.amount.value <= 0) reasons.push("Το ποσό πρέπει να είναι θετικό.");

  if (e.issue_date) {
    const d = new Date(e.issue_date);
    const now = new Date();
    const twoDaysAhead = new Date(now.getTime() + 2 * 86400000);
    if (Number.isNaN(d.getTime())) reasons.push("Μη έγκυρη ημερομηνία.");
    else if (d > twoDaysAhead) reasons.push("Η ημερομηνία είναι στο μέλλον.");
  }

  return { ok: reasons.length === 0, reasons };
}
