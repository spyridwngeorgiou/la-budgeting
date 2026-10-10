import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ingestUnified } from "./flag";

// «N πρόχειρες κινήσεις προς έλεγχο» on the dashboard: AI captures waiting
// for a person. Old path: pending transaction_drafts, opened in the draft
// review with the rest queued. INGEST_UNIFIED: undecided rows of staged
// ai_* batches, opened in the inbox review of the oldest one.

export const AI_SOURCES = ["ai_document", "ai_nl", "ai_email"] as const;

export async function loadPendingCaptures(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<{ count: number; href: string }> {
  if (ingestUnified()) {
    const { data, count } = await supabase
      .from("ingest_rows")
      .select("batch_id, created_at, ingest_batches!inner(status, source)", { count: "exact" })
      .eq("org_id", orgId)
      .eq("decision", "pending")
      .eq("ingest_batches.status", "staged")
      .in("ingest_batches.source", [...AI_SOURCES])
      .order("created_at")
      .limit(1);
    const first = data?.[0]?.batch_id;
    return { count: count ?? 0, href: first ? `/inbox/${first}` : "/inbox" };
  }

  const { data, count } = await supabase
    .from("transaction_drafts")
    .select("id", { count: "exact" })
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("created_at");
  // Straight into the review screen for the oldest pending draft, the rest
  // queued behind it (same ?queue= mechanism approveDraft/discardDraft
  // use to chain through several) -- not /documents/new, which is for
  // capturing a NEW entry.
  const [first, ...rest] = (data ?? []).map((d) => d.id);
  return {
    count: count ?? 0,
    href: first ? `/documents/${first}/review${rest.length > 0 ? `?queue=${rest.join(",")}` : ""}` : "/documents/new",
  };
}
