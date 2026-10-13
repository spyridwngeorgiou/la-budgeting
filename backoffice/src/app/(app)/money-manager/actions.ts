"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";

// Apply the decisions of one Money Manager import: each new row becomes a
// paid cash transaction — personal («Προσωπικά έξοδα») or a business payment
// of the chosen project — or is skipped. Rows without a decision stay pending.
export async function applyMoneyManager(importId: string, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const [{ data: rows }, { data: cash }, { data: personalCat }] = await Promise.all([
    supabase.from("mm_rows").select("*").eq("import_id", importId).eq("match_status", "new").is("committed_transaction_id", null),
    supabase.from("accounts").select("id").eq("kind", "cash").limit(1).single(),
    supabase.from("categories").select("id").eq("code", "ΠΡΟΣΩΠΙΚΆ_ΈΞΟΔΑ").maybeSingle(),
  ]);
  if (!cash) throw new Error("Δεν βρέθηκε λογαριασμός μετρητών.");

  for (const r of rows ?? []) {
    const choice = String(formData.get(`d_${r.id}`) ?? "");
    if (!choice) continue;
    if (choice === "skip") {
      await supabase.from("mm_rows").update({ decision: "skip" }).eq("id", r.id);
      continue;
    }
    const business = choice.startsWith("project:");
    const label = [r.category, r.subcategory].filter(Boolean).join(" · ") || "Μετρητά";
    const { data: tx, error } = await supabase
      .from("transactions")
      .insert({
        org_id: orgId, tx_date: r.tx_date, paid_on: r.tx_date, status: "paid", origin: "manual",
        direction: r.kind === "income" ? "income" : "expense", scope: business ? "business" : "personal",
        account_id: cash.id, project_id: business ? choice.slice(8) : null, category_id: business ? null : personalCat?.id ?? null,
        gross_amount: r.amount, net_amount: r.amount, vat_amount: 0, withholding_amount: 0,
        description: business && r.note ? `${r.note}` : label,
        notes: [r.note && !business ? r.note : null, `Από Money Manager (${r.account_label ?? "μετρητά"}).`].filter(Boolean).join(" · "),
        legacy_excel_id: `mm:${importId}:${r.row_no}`,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await supabase
      .from("mm_rows")
      .update({ decision: business ? "business" : "personal", project_id: business ? choice.slice(8) : null, committed_transaction_id: tx.id })
      .eq("id", r.id);
  }

  const { count } = await supabase.from("mm_rows").select("id", { count: "exact", head: true })
    .eq("import_id", importId).eq("match_status", "new").is("committed_transaction_id", null).neq("decision", "skip");
  if (!count) await supabase.from("mm_imports").update({ status: "applied", applied_at: new Date().toISOString() }).eq("id", importId);
  revalidatePath("/money-manager");
  revalidatePath("/notifications");
}

// «Ανέβασμα»: the Money Manager Excel picked from the phone's Files (or the
// computer), staged exactly like the shortcut does, as the signed-in user.
export async function uploadMoneyManager(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Διάλεξε το αρχείο Excel του Money Manager.");
  const { stageMoneyManager } = await import("@/lib/moneyManager");
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const buffer = await file.arrayBuffer();
  const path = `${orgId}/money-manager/${Date.now()}.xlsx`;
  await supabase.storage.from("aade-imports").upload(path, buffer, { contentType: file.type || undefined });
  await stageMoneyManager(supabase, orgId, { name: file.name, buffer, storagePath: path });
  revalidatePath("/money-manager");
}
