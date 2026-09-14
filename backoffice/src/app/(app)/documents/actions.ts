"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { aiEnabled, logAiUsage } from "@/lib/ai/client";
import { extractDocument, validateExtraction } from "@/lib/ai/extract";
import { extractFromText, validateNlExtraction } from "@/lib/ai/nl";
import { resolveEntities } from "@/lib/ai/resolve";
import { deriveFromGross, cashOnly } from "@/lib/finance/money";
import type { Extraction } from "@/lib/ai/schemas";

// Synchronous end-to-end for v1: upload, extract, resolve, and stage a draft
// all within one request. No queue/worker -- the dataset and document sizes
// here (a downscaled phone photo, one Opus call) comfortably fit inside a
// single request, and a job queue is complexity this doesn't need yet.
export async function uploadDocument(formData: FormData) {
  if (!aiEnabled()) {
    throw new Error("Ο βοηθός AI δεν είναι ενεργοποιημένος. Ορίστε ANTHROPIC_API_KEY και AI_ENABLED=true.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Επιλέξτε μια φωτογραφία ή αρχείο.");
  }

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const buffer = await file.arrayBuffer();
  const storagePath = `${orgId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);

  const { data: document, error: docError } = await supabase
    .from("documents")
    .insert({ org_id: orgId, storage_path: storagePath, mime_type: file.type, byte_size: file.size, uploaded_by: session?.user.id })
    .select("id")
    .single();
  if (docError) throw new Error(docError.message);

  const { data: job, error: jobError } = await supabase
    .from("document_jobs")
    .insert({ org_id: orgId, document_id: document.id, status: "processing" })
    .select("id")
    .single();
  if (jobError) throw new Error(jobError.message);

  const { data: categories } = await supabase.from("categories").select("name").order("sort_order");
  const categoryNames = (categories ?? []).map((c) => c.name);

  try {
    const base64 = Buffer.from(buffer).toString("base64");
    const { extraction, usage } = await extractDocument(base64, file.type, categoryNames);
    const validation = validateExtraction(extraction);
    const resolved = await resolveEntities(supabase, {
      issuerAfm: extraction.issuer_afm,
      issuerName: extraction.issuer_name,
      projectMention: extraction.project_mention,
      suggestedCategory: extraction.suggested_category,
    });

    const needsReview: string[] = [...validation.reasons];
    if (!resolved.contactId) needsReview.push("Δεν βρέθηκε αντίστοιχη επαφή -- επιλέξτε ή δημιουργήστε.");
    if (!resolved.projectId) needsReview.push("Δεν βρέθηκε αντίστοιχο έργο -- επιλέξτε.");

    const { data: draft, error: draftError } = await supabase
      .from("transaction_drafts")
      .insert({
        org_id: orgId,
        document_id: document.id,
        source: "ai_document",
        extracted: extraction,
        proposed: {
          contact_id: resolved.contactId,
          project_id: resolved.projectId,
          category_id: resolved.categoryId,
          contact_match_strength: resolved.contactMatchStrength,
        },
        needs_review_reasons: needsReview,
        status: "pending",
      })
      .select("id")
      .single();
    if (draftError) throw new Error(draftError.message);

    await supabase
      .from("document_jobs")
      .update({ status: "extracted", model: "claude-opus-5", input_tokens: usage.inputTokens, output_tokens: usage.outputTokens })
      .eq("id", job.id);

    await logAiUsage(supabase, {
      orgId,
      userId: session?.user.id ?? null,
      feature: "document_extraction",
      model: "claude-opus-5",
      inputTokens: usage.inputTokens,
      cacheReadTokens: 0,
      outputTokens: usage.outputTokens,
      requestId: usage.requestId,
    });

    redirect(`/documents/${draft.id}/review`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) throw error;
    await supabase
      .from("document_jobs")
      .update({ status: "failed", last_error: error instanceof Error ? error.message : String(error), attempts: 1 })
      .eq("id", job.id);
    throw new Error(
      error instanceof Error
        ? `Δεν μπορέσαμε να διαβάσουμε το παραστατικό: ${error.message}`
        : "Δεν μπορέσαμε να διαβάσουμε το παραστατικό.",
    );
  }
}

// The typed/spoken counterpart to uploadDocument -- same draft table, same
// review screen, same approveDraft gate. No document/storage involved, so
// no document_jobs row either (its document_id is NOT NULL); ai_usage still
// gets logged so spend is tracked regardless of entry method.
export async function submitNlEntry(formData: FormData) {
  if (!aiEnabled()) {
    throw new Error("Ο βοηθός AI δεν είναι ενεργοποιημένος. Ορίστε ANTHROPIC_API_KEY και AI_ENABLED=true.");
  }

  const text = String(formData.get("text") ?? "").trim();
  if (!text) throw new Error("Γράψτε ή πείτε μια περιγραφή της κίνησης.");

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { data: categories } = await supabase.from("categories").select("name").order("sort_order");
  const categoryNames = (categories ?? []).map((c) => c.name);

  const { extraction, usage } = await extractFromText(text, categoryNames);
  const validation = validateNlExtraction(extraction);
  const resolved = await resolveEntities(supabase, {
    issuerAfm: null,
    issuerName: extraction.counterparty_name,
    projectMention: extraction.project_mention,
    suggestedCategory: extraction.suggested_category,
  });

  const needsReview: string[] = [...validation.reasons];
  if (!resolved.contactId) needsReview.push("Δεν βρέθηκε αντίστοιχη επαφή -- επιλέξτε ή δημιουργήστε.");
  if (!resolved.projectId) needsReview.push("Δεν βρέθηκε αντίστοιχο έργο -- επιλέξτε.");

  // Normalise into the same shape as photo extraction so ReviewForm needs no
  // special-casing: derive net/VAT from the single stated amount (people say
  // what they handed over, i.e. gross) and carry the raw phrase as evidence.
  const amount = extraction.amount.value ?? 0;
  const breakdown = extraction.has_invoice ? deriveFromGross(amount, extraction.vat_rate ?? 0.24) : cashOnly(amount);
  const normalized: Extraction = {
    doc_type: "other",
    issuer_name: extraction.counterparty_name,
    issuer_afm: null,
    invoice_number: null,
    mydata_mark: null,
    issue_date: extraction.issue_date ?? new Date().toISOString().slice(0, 10),
    net: { value: breakdown.net, evidence: extraction.amount.evidence },
    vat: { value: breakdown.vat, evidence: extraction.amount.evidence },
    gross: { value: breakdown.gross, evidence: extraction.amount.evidence },
    vat_rate: extraction.vat_rate,
    withholding: { value: 0, evidence: null },
    payment_hint: "unknown",
    project_mention: extraction.project_mention,
    suggested_category: extraction.suggested_category,
    notes_for_human: [extraction.notes_for_human, `Περιγραφή: «${text}»`].filter(Boolean).join(" · "),
  };

  const { data: draft, error: draftError } = await supabase
    .from("transaction_drafts")
    .insert({
      org_id: orgId,
      document_id: null,
      source: "ai_nl",
      extracted: normalized,
      proposed: {
        contact_id: resolved.contactId,
        project_id: resolved.projectId,
        category_id: resolved.categoryId,
        contact_match_strength: resolved.contactMatchStrength,
        direction: extraction.direction,
      },
      needs_review_reasons: needsReview,
      status: "pending",
    })
    .select("id")
    .single();
  if (draftError) throw new Error(draftError.message);

  await logAiUsage(supabase, {
    orgId,
    userId: session?.user.id ?? null,
    feature: "nl_entry",
    model: "claude-haiku-4-5",
    inputTokens: usage.inputTokens,
    cacheReadTokens: 0,
    outputTokens: usage.outputTokens,
    requestId: usage.requestId,
  });

  redirect(`/documents/${draft.id}/review`);
}
