import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceRef } from "./links";

// Per-request state shared by the assistant's tools and the chat route.
// Tools append to it as a side effect (never read by the model): the route
// turns `sources` into the «Πηγές» footer and `changeIds` into approval
// cards once the turn is done.
export interface ChatToolContext {
  supabase: SupabaseClient;
  orgId: string;
  userId: string | null;
  conversationId: string | null;
  sources: SourceRef[];
  changeIds: string[];
  // Set by the route after any tool that returns free text written by
  // people (descriptions, notes) has run in this turn. Proposals made after
  // that are stored with untrusted_context so the reviewer is warned.
  untrustedSeen: boolean;
}

export function newChatToolContext(
  init: Pick<ChatToolContext, "supabase" | "orgId" | "userId" | "conversationId">,
): ChatToolContext {
  return { ...init, sources: [], changeIds: [], untrustedSeen: false };
}

// Tools whose results carry free text from the data (fenced as
// <record_data>): reading them is what makes later proposals "untrusted".
export const UNTRUSTED_TOOL_NAMES = new Set(["list_transactions", "outstanding", "find_record"]);
