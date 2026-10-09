"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin as requireAdmin, createServiceRoleClient } from "@/lib/supabase/admin";
import type { OrgRole } from "@/lib/domain/enums";
import { action, UserError, type ActionResult } from "@/lib/actions";

export async function updateMemberRole(userId: string, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await requireAdmin(supabase);
    const role = String(formData.get("role")) as OrgRole;

    const { error } = await supabase.from("org_members").update({ role }).eq("org_id", orgId).eq("user_id", userId);
    if (error) throw error;
    revalidatePath("/settings");
  });
}

export async function removeMember(userId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await requireAdmin(supabase);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user.id === userId) throw new UserError("Δεν μπορείτε να αφαιρέσετε τον εαυτό σας.");

    const { error } = await supabase.from("org_members").delete().eq("org_id", orgId).eq("user_id", userId);
    if (error) throw error;
    revalidatePath("/settings");
  });
}

// Creating a login needs the Admin API (auth.admin.createUser), which needs
// the service-role key -- the regular RLS-scoped client can't create auth
// users at all. Because that client bypasses RLS entirely, requireAdmin()
// (src/lib/supabase/admin.ts) is the only thing standing between "any logged-in user" and
// "can provision new logins for this org", so it's checked before any
// service-role call is made, not left to RLS to catch.
//
// The handle_new_user trigger (supabase/migrations/0002) auto-provisions a
// brand-new, empty org for every new auth.users row -- proven necessary by
// this session's own dangling-org cleanup for two existing accounts. Same
// create -> delete the auto org -> insert the real membership sequence as
// backoffice/scripts/create-internal-user.mjs, now as an in-app action.
// (External project partners never come through here: they are invited
// per project from projects/[id]/partner-actions.ts and never get an org
// membership at all.)
export async function inviteMember(formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await requireAdmin(supabase);

    const email = String(formData.get("email")).trim();
    const password = String(formData.get("password"));
    const role = String(formData.get("role")) as OrgRole;
    if (!email || password.length < 8) {
      throw new UserError("Χρειάζεται έγκυρο email και κωδικός τουλάχιστον 8 χαρακτήρων.");
    }

    const admin = createServiceRoleClient();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw new UserError(`Η δημιουργία χρήστη απέτυχε: ${createError.message}`);
    const newUserId = created.user.id;

    const { data: autoMemberships, error: autoError } = await admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", newUserId);
    if (autoError) throw autoError;

    for (const { org_id } of autoMemberships ?? []) {
      if (org_id === orgId) continue;
      await admin.from("orgs").delete().eq("id", org_id);
    }

    const { error: memberError } = await admin
      .from("org_members")
      .upsert({ org_id: orgId, user_id: newUserId, role }, { onConflict: "org_id,user_id" });
    if (memberError) throw memberError;

    revalidatePath("/settings");
  });
}
