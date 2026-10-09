import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { logAiUsage } from "@/lib/ai/client";
import { extractFromText, validateNlExtraction } from "@/lib/ai/nl";
import { resolveEntities } from "@/lib/ai/resolve";
import { todayAthens } from "@/lib/dates";
import { stageBatch } from "../stage";
import { orgCategoryNames } from "./aiDocument";
import { AI_TEXT_MODEL, aiExtractionToStageRow, needsReviewReasons, nlEntryToExtraction } from "./aiShared";

// Typed / spoken text (ai_nl) or an email body without attachments
// (ai_email) -> one batch, one staged row per transaction the text
// describes («50 στον υδραυλικό, 30 βενζίνη» is two rows). Each row is
// resolved on its own so amounts/parties/projects never bleed into each
// other, and each still needs its own decision in the inbox.

type Client = SupabaseClient<Database>;

export async function stageAiText(
  supabase: Client,
  input: {
    orgId: string;
    userId: string | null;
    source: "ai_nl" | "ai_email";
    text: string;
    // Prefix of the quoted original in notes_for_human: «Περιγραφή» / «Email».
    label: string;
    usageFeature: string;
    categoryNames?: string[];
    filename?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<{ batchId: string; rows: number }> {
  const { orgId, text } = input;
  const categoryNames = input.categoryNames ?? (await orgCategoryNames(supabase, orgId));
  const startedAt = Date.now();
  const { entries, usage } = await extractFromText(text, categoryNames);
  const latencyMs = Date.now() - startedAt;
  const today = todayAthens();

  const rows = [];
  for (const [i, entry] of entries.entries()) {
    const resolved = await resolveEntities(supabase, {
      issuerAfm: null,
      issuerName: entry.counterparty_name,
      projectMention: entry.project_mention,
      suggestedCategory: entry.suggested_category,
      orgId,
      rawText: text,
    });
    const proposal = {
      contactId: resolved.contactId,
      projectId: resolved.projectId,
      categoryId: resolved.categoryId,
      contactMatchStrength: resolved.contactMatchStrength,
      direction: entry.direction,
    };
    rows.push(
      aiExtractionToStageRow({
        rowNo: i + 1,
        extraction: nlEntryToExtraction(entry, text, input.label, today),
        proposal,
        needsReview: needsReviewReasons(validateNlExtraction(entry).reasons, proposal),
        model: AI_TEXT_MODEL,
        documentId: null,
        today,
      }),
    );
  }

  const staged = await stageBatch(supabase, {
    orgId,
    source: input.source,
    rows,
    filename: input.filename ?? null,
    createdBy: input.userId,
    meta: { text, ...input.meta },
  });

  await logAiUsage(supabase, {
    orgId,
    userId: input.userId,
    feature: input.usageFeature,
    model: AI_TEXT_MODEL,
    inputTokens: usage.inputTokens,
    cacheReadTokens: 0,
    outputTokens: usage.outputTokens,
    requestId: usage.requestId,
    latencyMs,
  });
  return { batchId: staged.batchId, rows: rows.length };
}
