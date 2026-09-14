import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, AI_MODEL } from "./client";
import { ExtractionSchema, type Extraction } from "./schemas";
import { isValidAfm } from "@/lib/finance/money";

const SYSTEM_PROMPT = `Είστε ειδικός στην ανάγνωση ελληνικών αποδείξεων και τιμολογίων. Η δουλειά σας είναι να ΜΕΤΑΓΡΑΨΕΤΕ πιστά ό,τι βλέπετε -- ποτέ μην υπολογίζετε ή διορθώνετε αριθμούς. Για κάθε χρηματικό πεδίο, γράψτε στο "evidence" το ακριβές κείμενο που διαβάσατε. Αν κάτι δεν είναι ευανάγνωστο ή απουσιάζει, βάλτε null -- ποτέ μην το μαντεύετε.`;

export interface ExtractionResult {
  extraction: Extraction;
  usage: { inputTokens: number; outputTokens: number; requestId: string };
}

export async function extractDocument(
  base64Data: string,
  mediaType: string,
  categoryNames: string[],
): Promise<ExtractionResult> {
  const isPdf = mediaType === "application/pdf";
  const contentBlock = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64Data } }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
          data: base64Data,
        },
      };

  const response = await anthropic.messages.parse({
    model: AI_MODEL,
    max_tokens: 4096,
    system: `${SYSTEM_PROMPT}\n\nΔιαθέσιμες κατηγορίες (χρησιμοποιήστε ακριβώς ένα από αυτά τα ονόματα στο suggested_category, ή null): ${categoryNames.join(", ")}`,
    messages: [{ role: "user", content: [contentBlock, { type: "text", text: "Μεταγράψτε αυτό το παραστατικό." }] }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Η ανάλυση του παραστατικού απέτυχε (μη έγκυρη μορφή απάντησης).");
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
