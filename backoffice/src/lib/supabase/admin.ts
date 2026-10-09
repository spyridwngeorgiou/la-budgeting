import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { getCurrentMembership } from "@/lib/supabase/org";
import { UserError } from "@/lib/actions";

// Gate for every action that goes on to use the service-role client below.
// That client bypasses RLS entirely, so this check -- made by the app, on the
// caller's own RLS-scoped session -- is the only authorization boundary left
// between "any logged-in user" and "can provision logins / memberships".
// Always call it before createServiceRoleClient(), never after.
export async function requireOrgAdmin(
  supabase: SupabaseClient,
  message = "Μόνο διαχειριστές μπορούν να διαχειριστούν την ομάδα.",
): Promise<string> {
  const { orgId, role } = await getCurrentMembership(supabase);
  if (role !== "admin" && role !== "owner") throw new UserError(message);
  return orgId;
}

// Needed only for the Auth Admin API (createUser / inviteUserByEmail) and
// the few lookups across users that RLS rightly hides (e.g. "does a login
// with this email already exist?"). Server-only: the key never ships to
// the browser because nothing under src/components imports this module.
export function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !url) {
    throw new Error("Λείπει το SUPABASE_SERVICE_ROLE_KEY στο περιβάλλον διακομιστή.");
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
