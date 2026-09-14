import type { SupabaseClient } from "@supabase/supabase-js";

// Every insert must carry org_id explicitly -- RLS's `with check` clause
// requires it to already be present on the row, it isn't inferred. Single-
// org-per-user is the only case that exists today (everyone sees/edits
// everything, per the current phase); this takes the first membership.
//
// Uses getSession() (decodes the cookie locally), not getUser() (a network
// round-trip to Auth to revalidate). The proxy middleware already called
// getUser() once for this exact request to decide whether to redirect to
// /login -- every page and action re-verifying again is a second network
// round trip for no additional safety, and it was showing up as real,
// measurable per-page latency.
export async function getCurrentOrgId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", session.user.id)
    .limit(1)
    .single();

  if (error || !data) throw new Error("Ο χρήστης δεν ανήκει σε κάποιον οργανισμό.");
  return data.org_id;
}

// For read-only display, skip the org_members hop entirely: RLS already
// scopes `orgs` to the caller's membership, so this is one round trip
// instead of two. Use getCurrentOrgId only where the org_id VALUE itself is
// needed (e.g. to stamp an insert).
export async function getCurrentOrg(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("orgs").select("*").limit(1).single();
  if (error || !data) throw new Error("Ο χρήστης δεν ανήκει σε κάποιον οργανισμό.");
  return data;
}

// FormData values are string | File | null; every select/hidden field we
// read is always a plain string or absent -- this narrows that safely
// instead of casting, so a stray <input type="file"> can't silently produce
// garbage in a money or foreign-key field.
export function formString(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string" || value === "") return null;
  return value;
}
