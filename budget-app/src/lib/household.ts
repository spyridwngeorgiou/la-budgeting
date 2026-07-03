import { createClient } from "@/lib/supabase/server";

/**
 * Returns the household id for the current user (first membership).
 * Assumes the user is authenticated (guarded by middleware).
 */
export async function getHouseholdId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  return data?.household_id ?? null;
}
