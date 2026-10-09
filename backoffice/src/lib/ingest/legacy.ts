import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ingestUnified } from "./flag";

// Old review URLs (/aade/<id>, /documents/<draft>/review) once
// INGEST_UNIFIED is on: the inbox batch 0072/0073 backfilled from that
// record, or null when it has not been backfilled (yet) -- the old screen
// then still shows it, so nothing becomes unreachable mid-cutover.
export async function legacyInboxHref(
  supabase: SupabaseClient<Database>,
  ref: `draft:${string}` | `aade:${string}`,
): Promise<string | null> {
  if (!ingestUnified()) return null;
  const { data } = await supabase.from("ingest_batches").select("id").eq("legacy_ref", ref).limit(1).maybeSingle();
  return data ? `/inbox/${data.id}` : null;
}
