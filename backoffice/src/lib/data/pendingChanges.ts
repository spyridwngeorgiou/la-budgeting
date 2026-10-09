import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Kansha AI proposals waiting for approval in this org: the Nav badge and
// the «Εκκρεμότητες (n)» link on /assistant read the same cached count.
export const countPendingChanges = cache(async (orgId: string): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase
    .from("agent_changes")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "pending");
  return count ?? 0;
});
