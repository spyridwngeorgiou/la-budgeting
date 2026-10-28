"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { startAuthorization } from "@/lib/bank/enableBanking";
import { APP_URL, BANKS, serviceClient } from "@/lib/bank/service";
import { syncBank } from "@/lib/bank/sync";

async function requireAdmin() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const { data: { user } } = await supabase.auth.getUser();
  const { data: m } = await supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user?.id ?? "").maybeSingle();
  if (!user || !m || !["owner", "admin"].includes(m.role)) throw new Error("Μόνο ο ιδιοκτήτης ή διαχειριστής συνδέει τράπεζες.");
  return { orgId, user };
}

// «Σύνδεση»: open the bank's own consent page (read-only, 180 days).
export async function connectBank(index: number) {
  const bank = BANKS[index];
  if (!bank) throw new Error("Άγνωστη τράπεζα.");
  const { orgId, user } = await requireAdmin();
  const sb = serviceClient(user.email ?? "bank-feed");
  const state = crypto.randomUUID();
  const validUntil = new Date(Date.now() + 179 * 86400000).toISOString();
  await sb.from("bank_connections").insert({ org_id: orgId, aspsp_name: bank.aspsp, psu_type: bank.psuType, auth_state: state, status: "pending", created_by: user.id });
  const { url } = await startAuthorization({ aspsp: bank.aspsp, psuType: bank.psuType, state, redirectUrl: `${APP_URL}/bank/callback`, validUntil });
  redirect(url);
}

// Which ledger account a bank account feeds.
export async function mapLink(linkId: string, formData: FormData) {
  await requireAdmin();
  const accountId = String(formData.get("account_id") ?? "") || null;
  const sb = serviceClient();
  await sb.from("bank_links").update({ account_id: accountId }).eq("id", linkId);
  revalidatePath("/bank");
}

// «Συγχρονισμός τώρα»: the same run as the scheduled one.
export async function syncNow() {
  const { orgId, user } = await requireAdmin();
  await syncBank(serviceClient(user.email ?? "bank-feed"), orgId);
  revalidatePath("/bank");
  revalidatePath("/notifications");
}
