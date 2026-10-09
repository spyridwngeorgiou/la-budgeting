import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { logAiUsage } from "@/lib/ai/client";
import { extractDocument, validateExtraction } from "@/lib/ai/extract";
import { resolveEntities } from "@/lib/ai/resolve";
import { todayAthens } from "@/lib/dates";
import { stageBatch } from "../stage";
import { AI_DOCUMENT_MODEL, aiExtractionToStageRow, needsReviewReasons } from "./aiShared";

// A photo / PDF of an invoice or receipt -> one staged ai_document (or
// ai_email) row, the document kept in storage and linked on the row so the
// inbox review shows it next to the fields. Used by /documents/new (RLS
// client) and the email webhook (service role) -- every query pins orgId.

type Client = SupabaseClient<Database>;

export async function orgCategoryNames(supabase: Client, orgId: string): Promise<string[]> {
  // Service role bypasses RLS: without the org filter every org's category
  // names would reach this org's extraction prompt.
  const { data } = await supabase.from("categories").select("name").eq("org_id", orgId).order("sort_order");
  return (data ?? []).map((c) => c.name);
}

export class CaptureError extends Error {}

export async function stageAiDocument(
  supabase: Client,
  input: {
    orgId: string;
    userId: string | null;
    source: "ai_document" | "ai_email";
    file: { name: string; mimeType: string; bytes: Uint8Array };
    categoryNames?: string[];
    usageFeature: string;
    meta?: Record<string, unknown>;
  },
): Promise<{ batchId: string }> {
  const { orgId, file } = input;
  const storagePath = `${orgId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, file.bytes, { contentType: file.mimeType });
  if (uploadError) throw uploadError;

  const { data: document, error: docError } = await supabase
    .from("documents")
    .insert({ org_id: orgId, storage_path: storagePath, mime_type: file.mimeType, byte_size: file.bytes.length, uploaded_by: input.userId })
    .select("id")
    .single();
  if (docError) throw docError;

  const { data: job } = await supabase
    .from("document_jobs")
    .insert({ org_id: orgId, document_id: document.id, status: "processing" })
    .select("id")
    .single();

  try {
    const categoryNames = input.categoryNames ?? (await orgCategoryNames(supabase, orgId));
    const startedAt = Date.now();
    const { extraction, usage } = await extractDocument(Buffer.from(file.bytes).toString("base64"), file.mimeType, categoryNames);
    const latencyMs = Date.now() - startedAt;
    const resolved = await resolveEntities(supabase, {
      issuerAfm: extraction.issuer_afm,
      issuerName: extraction.issuer_name,
      projectMention: extraction.project_mention,
      suggestedCategory: extraction.suggested_category,
      orgId,
      rawText: [extraction.supply_number, extraction.project_mention, extraction.notes_for_human].filter(Boolean).join(" "),
    });
    const proposal = {
      contactId: resolved.contactId,
      projectId: resolved.projectId,
      categoryId: resolved.categoryId,
      contactMatchStrength: resolved.contactMatchStrength,
    };
    const row = aiExtractionToStageRow({
      rowNo: 1,
      extraction,
      proposal,
      needsReview: needsReviewReasons(validateExtraction(extraction).reasons, proposal),
      model: AI_DOCUMENT_MODEL,
      documentId: document.id,
      today: todayAthens(),
    });

    const staged = await stageBatch(supabase, {
      orgId,
      source: input.source,
      rows: [row],
      filename: file.name,
      mimeType: file.mimeType,
      createdBy: input.userId,
      meta: { document_id: document.id, ...input.meta },
    });

    if (job) {
      await supabase
        .from("document_jobs")
        .update({ status: "extracted", model: AI_DOCUMENT_MODEL, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens })
        .eq("id", job.id);
    }
    await logAiUsage(supabase, {
      orgId,
      userId: input.userId,
      feature: input.usageFeature,
      model: AI_DOCUMENT_MODEL,
      inputTokens: usage.inputTokens,
      cacheReadTokens: 0,
      outputTokens: usage.outputTokens,
      requestId: usage.requestId,
      latencyMs,
    });
    return staged;
  } catch (error) {
    if (job) {
      await supabase
        .from("document_jobs")
        .update({ status: "failed", last_error: error instanceof Error ? error.message : String(error), attempts: 1 })
        .eq("id", job.id);
    }
    throw new CaptureError(
      error instanceof Error
        ? `Δεν μπορέσαμε να διαβάσουμε το παραστατικό: ${error.message}`
        : "Δεν μπορέσαμε να διαβάσουμε το παραστατικό.",
    );
  }
}
