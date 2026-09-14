import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ResolvedEntities {
  contactId: string | null;
  contactMatchStrength: "afm" | "name" | "none";
  projectId: string | null;
  categoryId: string | null;
}

// Deterministic resolution ladder, ΑΦΜ first -- the strong key. Never
// guesses a project: a misfiled receipt silently corrupts project P&L, so an
// unmatched project is left null (amber in the review UI) rather than
// picking the "closest" one. The full contact table is never sent to the
// model; resolution happens here in Postgres, which is what it's for.
export async function resolveEntities(
  supabase: SupabaseClient,
  input: { issuerAfm: string | null; issuerName: string | null; projectMention: string | null; suggestedCategory: string | null },
): Promise<ResolvedEntities> {
  let contactId: string | null = null;
  let contactMatchStrength: ResolvedEntities["contactMatchStrength"] = "none";

  if (input.issuerAfm) {
    const { data } = await supabase.from("contacts").select("id").eq("afm", input.issuerAfm).maybeSingle();
    if (data) {
      contactId = data.id;
      contactMatchStrength = "afm";
    }
  }

  if (!contactId && input.issuerName) {
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .ilike("name", `%${input.issuerName.trim()}%`)
      .limit(2);
    if (data && data.length === 1) {
      contactId = data[0].id;
      contactMatchStrength = "name";
    }
  }

  let projectId: string | null = null;
  if (input.projectMention) {
    const { data } = await supabase
      .from("projects")
      .select("id, aliases")
      .or(`display_name.ilike.%${input.projectMention.trim()}%`)
      .limit(2);
    if (data && data.length === 1) {
      projectId = data[0].id;
    } else if (data) {
      const alias = data.find((p) => (p.aliases ?? []).some((a: string) => input.projectMention!.toLowerCase().includes(a.toLowerCase())));
      if (alias) projectId = alias.id;
    }
  }

  let categoryId: string | null = null;
  if (input.suggestedCategory) {
    const { data } = await supabase.from("categories").select("id").eq("name", input.suggestedCategory).maybeSingle();
    if (data) categoryId = data.id;
  }

  return { contactId, contactMatchStrength, projectId, categoryId };
}
