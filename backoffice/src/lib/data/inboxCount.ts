import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { InboxCounts } from "@/lib/ingest/inboxCount";
import { countPendingChanges } from "./pendingChanges";

// The three counts behind the «Εισερχόμενα» badge, one head-only count
// query each (no rows travel). Cached per request: the layout and /inbox
// read the same numbers.
export const loadInboxCounts = cache(async (orgId: string): Promise<InboxCounts> => {
  const supabase = await createClient();
  const [{ count: rows }, changes, { count: proposals }] = await Promise.all([
    supabase
      .from("ingest_rows")
      .select("id, ingest_batches!inner(status)", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("decision", "pending")
      .eq("ingest_batches.status", "staged"),
    countPendingChanges(orgId),
    supabase
      .from("collab_ai_proposals")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
  ]);
  return { rows: rows ?? 0, changes, proposals: proposals ?? 0 };
});
