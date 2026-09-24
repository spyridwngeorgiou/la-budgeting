"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { deriveFromNet, cashOnly, isIdentityConsistent } from "@/lib/finance/money";

// The only path from an AI draft into the real ledger. Re-runs every
// validator server-side -- the client cannot be trusted to have enforced
// them, and "the model said high confidence" is never sufficient on its
// own. No auto-commit exists anywhere in this codebase, not even behind a
// setting: a human always looks at this exact form before anything is
// written to `transactions`.
// queue carries the remaining draft ids from a multi-transaction text/voice
// entry (submitNlEntry split them into separate drafts) -- approving or
// discarding one advances to the next instead of dropping the rest.
function nextInQueueOrElse(queue: string[], fallback: string) {
  if (queue.length === 0) return fallback;
  const [next, ...rest] = queue;
  return `/documents/${next}/review${rest.length > 0 ? `?queue=${rest.join(",")}` : ""}`;
}

export async function approveDraft(draftId: string, queue: string[], formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { data: draft, error: draftError } = await supabase
    .from("transaction_drafts")
    .select("id, document_id, extracted, source")
    .eq("id", draftId)
    .single();
  if (draftError || !draft) throw new Error("Το πρόχειρο δεν βρέθηκε.");

  const hasInvoice = formData.get("has_invoice") === "on";
  const netAmount = Number(formData.get("net_amount"));
  const vatRate = Number(formData.get("vat_rate") ?? 0);
  const withholding = Number(formData.get("withholding_amount") ?? 0);
  const breakdown = hasInvoice ? deriveFromNet(netAmount, vatRate, withholding) : cashOnly(netAmount);

  if (!isIdentityConsistent(breakdown)) {
    throw new Error("Ασυνέπεια στο ποσό: net + ΦΠΑ − παρακράτηση δεν ισούται με το σύνολο.");
  }

  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .insert({
      org_id: orgId,
      tx_date: String(formData.get("tx_date")),
      contact_id: formString(formData, "contact_id"),
      project_id: formString(formData, "project_id"),
      category_id: formString(formData, "category_id"),
      account_id: formString(formData, "account_id"),
      direction: String(formData.get("direction")) as "income" | "expense",
      scope: (formString(formData, "scope") as "business" | "personal") ?? "business",
      status: (formString(formData, "status") as "paid" | "pending" | "scheduled") ?? "pending",
      origin: draft.source,
      net_amount: breakdown.net,
      vat_amount: breakdown.vat,
      vat_rate: hasInvoice ? vatRate : null,
      withholding_amount: breakdown.withholding,
      gross_amount: breakdown.gross,
      has_invoice: hasInvoice,
      invoice_number: formString(formData, "invoice_number"),
      description: formString(formData, "description"),
      source_document_id: draft.document_id,
    })
    .select("id")
    .single();
  if (txError) throw new Error(txError.message);

  // Diff draft vs submitted for the learning-loop table -- nearly free, and
  // building it from the first version means no signal is lost retrofitting
  // it later. One row per field a human actually changed.
  const extracted = draft.extracted as Record<string, unknown>;
  const corrections: { field: string; ai_value: string | number | null; human_value: string | number | null }[] = [];
  const compareField = (field: string, aiValue: string | number | null | undefined, humanValue: string | number | null | undefined) => {
    if (aiValue != null && String(aiValue) !== String(humanValue)) {
      corrections.push({ field, ai_value: aiValue, human_value: humanValue ?? null });
    }
  };
  const netField = extracted.net as { value: number | null } | undefined;
  const vatField = extracted.vat as { value: number | null } | undefined;
  compareField("net_amount", netField?.value, breakdown.net);
  compareField("vat_amount", vatField?.value, breakdown.vat);
  compareField("issue_date", extracted.issue_date as string | null, String(formData.get("tx_date")));

  if (corrections.length > 0) {
    await supabase.from("ai_corrections").insert(
      corrections.map((c) => ({
        org_id: orgId,
        document_id: draft.document_id,
        // document_id is null for every ai_nl (text/voice) draft -- draft_id
        // works for both capture paths, so edit-rate can finally be split
        // by method, not just attributed to photos.
        draft_id: draftId,
        field: c.field,
        ai_value: c.ai_value,
        human_value: c.human_value,
        model: draft.source === "ai_nl" ? "claude-haiku-4-5" : "claude-opus-5",
      })),
    );
  }

  await supabase
    .from("transaction_drafts")
    .update({ status: "approved", approved_transaction_id: tx.id })
    .eq("id", draftId);

  revalidatePath("/transactions");
  redirect(nextInQueueOrElse(queue, "/transactions"));
}

export async function discardDraft(draftId: string, queue: string[] = []) {
  const supabase = await createClient();
  await supabase.from("transaction_drafts").update({ status: "discarded" }).eq("id", draftId);
  revalidatePath("/documents");
  redirect(nextInQueueOrElse(queue, "/dashboard"));
}
