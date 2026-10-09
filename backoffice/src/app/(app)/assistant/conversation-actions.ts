"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { toChangeCard, type ChangeCard } from "@/lib/ai/changeCards";
import { readMeta } from "@/lib/ai/chatProtocol";
import type { Source } from "@/lib/ai/links";

// Saved assistant history (0081). RLS keeps every query to the caller's own
// conversations; these actions only shape the rows for ChatPanel.

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface SavedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  proposals: ChangeCard[];
}

const CHANGE_COLUMNS =
  "id, status, operation, table_name, action, reason, before, after, changed_fields, conflict, untrusted_context, error, result, created_at";

const idSchema = z.uuid();

export async function listConversations(): Promise<ActionResult<ConversationSummary[]>> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }));
  });
}

export async function loadConversation(id: string): Promise<ActionResult<SavedMessage[]>> {
  return action(async () => {
    if (!idSchema.safeParse(id).success) throw new UserError("Η συζήτηση δεν βρέθηκε.");
    const supabase = await createClient();
    const { data: rows, error } = await supabase
      .from("ai_messages")
      .select("id, role, content, meta, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;

    const metas = (rows ?? []).map((r) => readMeta(r.meta));
    const changeIds = [...new Set(metas.flatMap((m) => m.changeIds))];
    const { data: changes } = changeIds.length
      ? await supabase.from("agent_changes").select(CHANGE_COLUMNS).in("id", changeIds)
      : { data: [] };
    const cards = new Map((changes ?? []).map((c) => [c.id, toChangeCard(c)]));

    return (rows ?? []).map((r, i) => ({
      id: r.id,
      role: r.role === "assistant" ? "assistant" : "user",
      content: r.content,
      sources: metas[i].sources,
      proposals: metas[i].changeIds.map((cid) => cards.get(cid)).filter((c): c is ChangeCard => !!c),
    }));
  });
}

export async function deleteConversation(id: string): Promise<ActionResult> {
  return action(async () => {
    if (!idSchema.safeParse(id).success) throw new UserError("Η συζήτηση δεν βρέθηκε.");
    const supabase = await createClient();
    const { error } = await supabase.from("ai_conversations").delete().eq("id", id);
    if (error) throw error;
  });
}
