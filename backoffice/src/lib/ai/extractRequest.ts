import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ExtractionSchema } from "./schemas";
import { EXTRACTION_EFFORT, EXTRACTION_MODEL, REFUSAL_FALLBACK_BETA } from "./models";

// The pure half of document extraction: the request body for one receipt /
// invoice. Kept out of extract.ts ("server-only") so vitest and the
// extraction eval build exactly the request production sends.
//
// Structured outputs (output_config.format), not a forced tool call: Sonnet
// 5.5 and Opus 5.5 return a 400 on tool_choice any/tool, and on
// thinking {type:"disabled"}. Thinking is left at its default (adaptive);
// effort is the only depth control and is set explicitly.

export const EXTRACTION_SYSTEM_PROMPT = `Είστε ειδικός στην ανάγνωση ελληνικών αποδείξεων και τιμολογίων. Η δουλειά σας είναι να ΜΕΤΑΓΡΑΨΕΤΕ πιστά ό,τι βλέπετε -- ποτέ μην υπολογίζετε ή διορθώνετε αριθμούς. Για κάθε χρηματικό πεδίο, γράψτε στο "evidence" το ακριβές κείμενο που διαβάσατε. Αν κάτι δεν είναι ευανάγνωστο ή απουσιάζει, βάλτε null -- ποτέ μην το μαντεύετε.`;

// Thinking counts toward max_tokens; the JSON itself is ~1-2K tokens.
export const EXTRACTION_MAX_TOKENS = 16000;

export type ExtractionEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ExtractionRequestInput {
  base64Data: string;
  mediaType: string;
  categoryNames: string[];
  model?: string;
  // null = send no effort (the model's own default) -- the eval uses this to
  // reproduce the pre-migration claude-opus-5 request.
  effort?: ExtractionEffort | null;
}

export function extractionRequest(input: ExtractionRequestInput) {
  const isPdf = input.mediaType === "application/pdf";
  const contentBlock = isPdf
    ? {
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: input.base64Data },
      }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: input.mediaType as "image/jpeg" | "image/png" | "image/webp",
          data: input.base64Data,
        },
      };
  const effort = input.effort === undefined ? EXTRACTION_EFFORT : input.effort;

  return {
    model: input.model ?? EXTRACTION_MODEL,
    max_tokens: EXTRACTION_MAX_TOKENS,
    system: `${EXTRACTION_SYSTEM_PROMPT}\n\nΔιαθέσιμες κατηγορίες (χρησιμοποιήστε ακριβώς ένα από αυτά τα ονόματα στο suggested_category, ή null): ${input.categoryNames.join(", ")}`,
    messages: [
      {
        role: "user" as const,
        content: [contentBlock, { type: "text" as const, text: "Μεταγράψτε αυτό το παραστατικό." }],
      },
    ],
    output_config: {
      format: betaZodOutputFormat(ExtractionSchema),
      ...(effort ? { effort } : {}),
    },
    // Server-side refusal fallback (Claude API only): retries a declined
    // request on the model's default fallback; response.model says who served it.
    betas: [REFUSAL_FALLBACK_BETA],
    fallbacks: "default" as const,
  };
}
