import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { aiEnabled, assertWithinAiBudget, logAiUsage } from "@/lib/ai/client";
import { extractDocument, validateExtraction } from "@/lib/ai/extract";
import { extractFromText, validateNlExtraction } from "@/lib/ai/nl";
import { resolveEntities } from "@/lib/ai/resolve";
import { deriveFromGross, cashOnly } from "@/lib/finance/money";
import type { Extraction } from "@/lib/ai/schemas";
import type { Database } from "@/lib/db/types";

// Postmark's inbound webhook shape (the fields this route actually reads;
// Postmark sends more than this). See https://postmarkapp.com/developer/webhooks/inbound-webhook
interface PostmarkInboundPayload {
  To: string;
  From: string;
  Subject?: string;
  TextBody?: string;
  Attachments?: { Name: string; ContentType: string; Content: string }[];
}

const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

// Third entry point into the same draft pipeline as uploadDocument and
// submitNlEntry (src/app/(app)/documents/actions.ts) -- an inbound email has
// no user session, so this route authenticates via a shared webhook secret
// instead, uses a service-role client (bypassing RLS) to look up which org
// the recipient address belongs to, and otherwise never touches
// `transactions` -- only ever inserts into transaction_drafts, exactly like
// the two existing channels. approveDraft (documents/[id]/review/actions.ts)
// remains the only path into the real ledger.
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !url) {
    return NextResponse.json({ ok: false, error: "server misconfigured" }, { status: 500 });
  }
  const admin = createSupabaseClient<Database>(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let payload: PostmarkInboundPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: true, skipped: "invalid payload" }, { status: 200 });
  }

  // Returning 200 for every "not for us" case below is deliberate -- a 4xx/5xx
  // to an inbound-mail provider typically triggers retries or a bounce back
  // to the sender, which is wrong for "this email just isn't for us."
  const toAddress = extractRecipientAddress(payload.To);
  if (!toAddress) {
    return NextResponse.json({ ok: true, skipped: "no recipient" }, { status: 200 });
  }

  const { data: mapping } = await admin
    .from("email_inbound_addresses")
    .select("org_id")
    .eq("address", toAddress)
    .maybeSingle();
  if (!mapping) {
    return NextResponse.json({ ok: true, skipped: "unknown recipient" }, { status: 200 });
  }
  const orgId = mapping.org_id;

  if (!aiEnabled()) {
    return NextResponse.json({ ok: true, skipped: "AI disabled" }, { status: 200 });
  }
  try {
    await assertWithinAiBudget(admin, orgId);
  } catch {
    return NextResponse.json({ ok: true, skipped: "over AI budget" }, { status: 200 });
  }

  const { data: categories } = await admin.from("categories").select("name").order("sort_order");
  const categoryNames = (categories ?? []).map((c) => c.name);

  const attachments = (payload.Attachments ?? []).filter((a) => SUPPORTED_ATTACHMENT_MIME_TYPES.has(a.ContentType));

  if (attachments.length > 0) {
    for (const attachment of attachments) {
      await ingestAttachment(admin, orgId, categoryNames, attachment);
    }
  } else {
    const text = (payload.TextBody ?? "").trim() || (payload.Subject ?? "").trim();
    if (text) {
      await ingestText(admin, orgId, categoryNames, text);
    }
  }

  return NextResponse.json({ ok: true });
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.EMAIL_INBOUND_WEBHOOK_SECRET;
  if (!expected) return false; // fail closed if the secret was never configured

  const auth = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }
  // Postmark's Basic Auth sends "username:password" -- only the password half
  // is meaningful here, the username is an arbitrary label.
  const password = decoded.split(":").slice(1).join(":");
  return timingSafeEqual(password, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractRecipientAddress(to: string | undefined): string | null {
  if (!to) return null;
  // "Name <addr@example.com>" or a plain "addr@example.com" -- take the
  // first recipient if Postmark sends a comma-separated list.
  const first = to.split(",")[0].trim();
  const match = first.match(/<([^>]+)>/);
  const address = (match ? match[1] : first).trim().toLowerCase();
  return address || null;
}

async function ingestAttachment(
  admin: SupabaseClient<Database>,
  orgId: string,
  categoryNames: string[],
  attachment: NonNullable<PostmarkInboundPayload["Attachments"]>[number],
) {
  const buffer = Buffer.from(attachment.Content, "base64");
  const storagePath = `${orgId}/${Date.now()}-${attachment.Name}`;

  const { error: uploadError } = await admin.storage.from("documents").upload(storagePath, buffer, {
    contentType: attachment.ContentType,
  });
  if (uploadError) return; // can't do much with a storage failure on a webhook -- skip this attachment

  const { data: document, error: docError } = await admin
    .from("documents")
    .insert({ org_id: orgId, storage_path: storagePath, mime_type: attachment.ContentType, byte_size: buffer.length, uploaded_by: null })
    .select("id")
    .single();
  if (docError || !document) return;

  const { data: job } = await admin
    .from("document_jobs")
    .insert({ org_id: orgId, document_id: document.id, status: "processing" })
    .select("id")
    .single();

  try {
    const startedAt = Date.now();
    const { extraction, usage } = await extractDocument(attachment.Content, attachment.ContentType, categoryNames);
    const latencyMs = Date.now() - startedAt;
    const validation = validateExtraction(extraction);
    const resolved = await resolveEntities(admin, {
      issuerAfm: extraction.issuer_afm,
      issuerName: extraction.issuer_name,
      projectMention: extraction.project_mention,
      suggestedCategory: extraction.suggested_category,
      orgId,
      rawText: [extraction.supply_number, extraction.project_mention, extraction.notes_for_human].filter(Boolean).join(" "),
    });

    const needsReview: string[] = [...validation.reasons];
    if (!resolved.contactId) needsReview.push("Δεν βρέθηκε αντίστοιχη επαφή -- επιλέξτε ή δημιουργήστε.");
    if (!resolved.projectId) needsReview.push("Δεν βρέθηκε αντίστοιχο έργο -- επιλέξτε.");

    await admin.from("transaction_drafts").insert({
      org_id: orgId,
      document_id: document.id,
      source: "ai_email",
      extracted: extraction,
      proposed: {
        contact_id: resolved.contactId,
        project_id: resolved.projectId,
        category_id: resolved.categoryId,
        contact_match_strength: resolved.contactMatchStrength,
      },
      needs_review_reasons: needsReview,
      status: "pending",
    });

    if (job) {
      await admin
        .from("document_jobs")
        .update({ status: "extracted", model: "claude-opus-5", input_tokens: usage.inputTokens, output_tokens: usage.outputTokens })
        .eq("id", job.id);
    }

    await logAiUsage(admin, {
      orgId,
      userId: null,
      feature: "email_document_extraction",
      model: "claude-opus-5",
      inputTokens: usage.inputTokens,
      cacheReadTokens: 0,
      outputTokens: usage.outputTokens,
      requestId: usage.requestId,
      latencyMs,
    });
  } catch (error) {
    if (job) {
      await admin
        .from("document_jobs")
        .update({ status: "failed", last_error: error instanceof Error ? error.message : String(error), attempts: 1 })
        .eq("id", job.id);
    }
  }
}

async function ingestText(
  admin: SupabaseClient<Database>,
  orgId: string,
  categoryNames: string[],
  text: string,
) {
  const startedAt = Date.now();
  const { entries, usage } = await extractFromText(text, categoryNames);
  const latencyMs = Date.now() - startedAt;

  for (const entry of entries) {
    const validation = validateNlExtraction(entry);
    const resolved = await resolveEntities(admin, {
      issuerAfm: null,
      issuerName: entry.counterparty_name,
      projectMention: entry.project_mention,
      suggestedCategory: entry.suggested_category,
      orgId,
      rawText: text,
    });

    const needsReview: string[] = [...validation.reasons];
    if (!resolved.contactId) needsReview.push("Δεν βρέθηκε αντίστοιχη επαφή -- επιλέξτε ή δημιουργήστε.");
    if (!resolved.projectId) needsReview.push("Δεν βρέθηκε αντίστοιχο έργο -- επιλέξτε.");

    const amount = entry.amount.value ?? 0;
    const breakdown = entry.has_invoice ? deriveFromGross(amount, entry.vat_rate ?? 0.24) : cashOnly(amount);
    const normalized: Extraction = {
      doc_type: "other",
      issuer_name: entry.counterparty_name,
      issuer_afm: null,
      invoice_number: null,
      mydata_mark: null,
      issue_date: entry.issue_date ?? new Date().toISOString().slice(0, 10),
      net: { value: breakdown.net, evidence: entry.amount.evidence },
      vat: { value: breakdown.vat, evidence: entry.amount.evidence },
      gross: { value: breakdown.gross, evidence: entry.amount.evidence },
      vat_rate: entry.vat_rate,
      withholding: { value: 0, evidence: null },
      payment_hint: "unknown",
      project_mention: entry.project_mention,
      supply_number: null,
      suggested_category: entry.suggested_category,
      notes_for_human: [entry.notes_for_human, `Email: «${text}»`].filter(Boolean).join(" · "),
    };

    await admin.from("transaction_drafts").insert({
      org_id: orgId,
      document_id: null,
      source: "ai_email",
      extracted: normalized,
      proposed: {
        contact_id: resolved.contactId,
        project_id: resolved.projectId,
        category_id: resolved.categoryId,
        contact_match_strength: resolved.contactMatchStrength,
        direction: entry.direction,
      },
      needs_review_reasons: needsReview,
      status: "pending",
    });
  }

  await logAiUsage(admin, {
    orgId,
    userId: null,
    feature: "email_nl_entry",
    model: "claude-haiku-4-5",
    inputTokens: usage.inputTokens,
    cacheReadTokens: 0,
    outputTokens: usage.outputTokens,
    requestId: usage.requestId,
    latencyMs,
  });
}
