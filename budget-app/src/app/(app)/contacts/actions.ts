"use server";

import { createClient } from "@/lib/supabase/server";
import { getHouseholdId } from "@/lib/household";
import { revalidateAll } from "@/lib/revalidate";

export async function createContact(formData: FormData) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const supabase = await createClient();
  const paymentTermsRaw = Number(formData.get("payment_terms_days") ?? 0);
  const vatRateRaw = Number(formData.get("default_vat_rate") ?? 0);
  const withholdingRateRaw = Number(
    formData.get("default_withholding_rate") ?? 0,
  );
  await supabase.from("contacts").insert({
    household_id: householdId,
    name: String(formData.get("name") ?? "").trim() || "Νέα επαφή",
    kind: String(formData.get("kind") ?? "vendor"),
    contact_type: String(formData.get("contact_type") ?? "supplier"),
    vat_number: String(formData.get("vat_number") ?? "").trim() || null,
    payment_terms_days: paymentTermsRaw > 0 ? paymentTermsRaw : null,
    iban: String(formData.get("iban") ?? "").trim() || null,
    default_vat_rate: vatRateRaw > 0 ? vatRateRaw : null,
    default_withholding_rate: withholdingRateRaw > 0 ? withholdingRateRaw : null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidateAll();
}

export async function updateContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const paymentTermsRaw = Number(formData.get("payment_terms_days") ?? 0);
  const vatRateRaw = Number(formData.get("default_vat_rate") ?? 0);
  const withholdingRateRaw = Number(
    formData.get("default_withholding_rate") ?? 0,
  );
  await supabase
    .from("contacts")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      kind: String(formData.get("kind") ?? "vendor"),
      contact_type: String(formData.get("contact_type") ?? "supplier"),
      vat_number: String(formData.get("vat_number") ?? "").trim() || null,
      payment_terms_days: paymentTermsRaw > 0 ? paymentTermsRaw : null,
      iban: String(formData.get("iban") ?? "").trim() || null,
      default_vat_rate: vatRateRaw > 0 ? vatRateRaw : null,
      default_withholding_rate: withholdingRateRaw > 0 ? withholdingRateRaw : null,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", id);
  revalidateAll();
}

export async function deleteContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("contacts").delete().eq("id", id);
  revalidateAll();
}
