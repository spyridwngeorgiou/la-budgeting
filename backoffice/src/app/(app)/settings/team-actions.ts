"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/supabase/org";
import type { OrgRole } from "@/lib/domain/enums";

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { orgId, role } = await getCurrentMembership(supabase);
  if (role !== "admin" && role !== "owner") {
    throw new Error("Μόνο διαχειριστές μπορούν να διαχειριστούν την ομάδα.");
  }
  return orgId;
}

export async function updateMemberRole(userId: string, formData: FormData) {
  const supabase = await createClient();
  const orgId = await requireAdmin(supabase);
  const role = String(formData.get("role")) as OrgRole;

  const { error } = await supabase.from("org_members").update({ role }).eq("org_id", orgId).eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function removeMember(userId: string) {
  const supabase = await createClient();
  const orgId = await requireAdmin(supabase);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user.id === userId) throw new Error("Δεν μπορείτε να αφαιρέσετε τον εαυτό σας.");

  const { error } = await supabase.from("org_members").delete().eq("org_id", orgId).eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

// Creating a login needs the Admin API (auth.admin.createUser), which needs
// the service-role key -- the regular RLS-scoped client can't create auth
// users at all. Because that client bypasses RLS entirely, requireAdmin()
// above is the only thing standing between "any logged-in user" and
// "can provision new logins for this org", so it's checked before any
// service-role call is made, not left to RLS to catch.
//
// The handle_new_user trigger (supabase/migrations/0002) auto-provisions a
// brand-new, empty org for every new auth.users row -- proven necessary by
// this session's own dangling-org cleanup for two existing accounts. Same
// create -> delete the auto org -> insert the real membership sequence as
// backoffice/scripts/create-partner-user.mjs, now as an in-app action.
export async function inviteMember(formData: FormData) {
  const supabase = await createClient();
  const orgId = await requireAdmin(supabase);

  const email = String(formData.get("email")).trim();
  const password = String(formData.get("password"));
  const role = String(formData.get("role")) as OrgRole;
  if (!email || password.length < 8) {
    throw new Error("Χρειάζεται έγκυρο email και κωδικός τουλάχιστον 8 χαρακτήρων.");
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !url) {
    throw new Error("Λείπει το SUPABASE_SERVICE_ROLE_KEY στο περιβάλλον διακομιστή.");
  }
  const admin = createSupabaseClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(createError.message);
  const newUserId = created.user.id;

  const { data: autoMemberships, error: autoError } = await admin
    .from("org_members")
    .select("org_id")
    .eq("user_id", newUserId);
  if (autoError) throw new Error(autoError.message);

  for (const { org_id } of autoMemberships ?? []) {
    if (org_id === orgId) continue;
    await admin.from("orgs").delete().eq("id", org_id);
  }

  const { error: memberError } = await admin
    .from("org_members")
    .upsert({ org_id: orgId, user_id: newUserId, role }, { onConflict: "org_id,user_id" });
  if (memberError) throw new Error(memberError.message);

  revalidatePath("/settings");
}
