import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { EXTRACTION_MODEL, REFUSAL_FALLBACK_BETA } from "./models";
import type { ExtractionEffort } from "./extractRequest";

// The pure half of reading a PDF bank statement (Optima «Ιστορικό
// συναλλαγών λογαριασμού» and the like): the strict schema and the request
// body. Same stack as receipt extraction (extractRequest.ts): Sonnet,
// structured outputs, no forced tool call, explicit effort. The model
// TRANSCRIBES -- every amount also comes back as the literal text it read,
// and the server re-parses that text and re-checks the running balance.

const StatementRow = z.object({
  date: z.string().describe("Ημερομηνία συναλλαγής σε μορφή ISO YYYY-MM-DD"),
  value_date: z.string().nullable().describe("Ημερομηνία αξίας σε μορφή ISO YYYY-MM-DD, ή null"),
  description: z.string().describe("Η πρώτη «Περιγραφή» της γραμμής, ενωμένη σε μία γραμμή, π.χ. «ΜΕΤΑΦΟΡΑ ΠΡΟΣ …» ή «ΕΞΟΔΑ ΜΕΤΑΦΟΡΑΣ»"),
  code: z.string().nullable().describe("Ο «Κωδικός συναλλαγής» ακριβώς όπως γράφεται, ή null"),
  amount: z.number().describe("Το ποσό με πρόσημο όπως αναγράφεται: αρνητικό για χρέωση/ανάληψη, θετικό για πίστωση"),
  amount_text: z.string().describe("Το ακριβές κείμενο του ποσού, π.χ. «-1.234,56 EUR»"),
  balance: z.number().nullable().describe("Το «Υπόλοιπο» μετά την κίνηση, όπως αναγράφεται, ή null"),
  balance_text: z.string().nullable().describe("Το ακριβές κείμενο του υπολοίπου, ή null"),
  counterparty_name: z.string().nullable().describe("Από τη 2η «Περιγραφή»: το όνομα του αντισυμβαλλόμενου, ή null"),
  counterparty_iban: z.string().nullable().describe("Από τη 2η «Περιγραφή»: το IBAN του αντισυμβαλλόμενου χωρίς κενά, ή null"),
  details: z.string().nullable().describe("Ολόκληρη η 2η «Περιγραφή» ενωμένη σε μία γραμμή, ή null"),
});

export const BankStatementSchema = z.object({
  account_number: z.string().nullable().describe("«Αριθμός λογαριασμού» μόνο ψηφία, ή null"),
  iban: z.string().nullable().describe("IBAN του λογαριασμού του αντιγράφου χωρίς κενά, αν αναγράφεται, αλλιώς null"),
  available_balance: z.number().nullable().describe("«Διαθέσιμο υπόλοιπο» της κεφαλίδας, ή null"),
  period_text: z.string().nullable().describe("Το κείμενο της «Περίοδος» όπως γράφεται, ή null"),
  period_start: z.string().nullable().describe("Αρχή περιόδου ISO YYYY-MM-DD αν η περίοδος έχει ημερομηνίες, αλλιώς null"),
  period_end: z.string().nullable().describe("Τέλος περιόδου ISO YYYY-MM-DD αν η περίοδος έχει ημερομηνίες, αλλιώς null"),
  rows: z.array(StatementRow).describe("Κάθε γραμμή του πίνακα, με τη σειρά του εγγράφου, από όλες τις σελίδες"),
});

export type BankStatementExtraction = z.infer<typeof BankStatementSchema>;
export type BankStatementRow = z.infer<typeof StatementRow>;

export const BANK_STATEMENT_SYSTEM_PROMPT = `Είστε ειδικός στην ανάγνωση ελληνικών αντιγράφων κίνησης τραπεζικού λογαριασμού. Η δουλειά σας είναι να ΜΕΤΑΓΡΑΨΕΤΕ πιστά κάθε γραμμή του πίνακα κινήσεων, από όλες τις σελίδες και με τη σειρά που εμφανίζονται -- ποτέ μην υπολογίζετε, διορθώνετε, ενώνετε ή παραλείπετε γραμμές. Οι γραμμές «ΕΞΟΔΑ ΜΕΤΑΦΟΡΑΣ» ή προμήθειας είναι χωριστές γραμμές, ακόμη κι αν έχουν τον ίδιο κωδικό με τη μεταφορά. Κείμενο που αναδιπλώνεται σε επόμενη γραμμή ανήκει στο ίδιο κελί. Αν κάτι δεν είναι ευανάγνωστο ή απουσιάζει, βάλτε null -- ποτέ μην το μαντεύετε.`;

// A 100-200 line statement is ~10-20K output tokens of JSON; thinking counts
// toward max_tokens too. The SDK's non-streaming guard does not apply (the
// client sets its own timeout); the call passes a longer one (bankStatement.ts).
export const BANK_STATEMENT_MAX_TOKENS = 48000;
// Reading typed text off a generated PDF is plain transcription: low effort.
export const BANK_STATEMENT_EFFORT = "low" as const;

export function bankStatementRequest(input: { base64Data: string; model?: string; effort?: ExtractionEffort | null }) {
  const effort = input.effort === undefined ? BANK_STATEMENT_EFFORT : input.effort;
  return {
    model: input.model ?? EXTRACTION_MODEL,
    max_tokens: BANK_STATEMENT_MAX_TOKENS,
    system: BANK_STATEMENT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "document" as const,
            source: { type: "base64" as const, media_type: "application/pdf" as const, data: input.base64Data },
          },
          { type: "text" as const, text: "Μεταγράψτε την κεφαλίδα και όλες τις κινήσεις αυτού του αντιγράφου." },
        ],
      },
    ],
    output_config: {
      format: betaZodOutputFormat(BankStatementSchema),
      ...(effort ? { effort } : {}),
    },
    betas: [REFUSAL_FALLBACK_BETA],
    fallbacks: "default" as const,
  };
}
