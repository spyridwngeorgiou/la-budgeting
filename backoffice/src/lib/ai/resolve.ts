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
    const needle = input.issuerName.trim();
    const { data } = await supabase.from("contacts").select("id, name").ilike("name", `%${needle}%`).limit(2);
    if (data && data.length === 1) {
      contactId = data[0].id;
      contactMatchStrength = "name";
    } else if (!data || data.length === 0) {
      // Forward ilike misses the common case where the read/typed name is
      // the fuller legal form and the stored contact is the short name people
      // actually use (e.g. issuer "ΔΕΗ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ" vs contact "ΔΕΗ") --
      // try the reverse containment before giving up. Still only resolves on
      // a single unambiguous hit; anything else is left for human review.
      const { data: all } = await supabase.from("contacts").select("id, name");
      const matches = (all ?? []).filter((c) => needle.toLowerCase().includes(c.name.trim().toLowerCase()));
      if (matches.length === 1) {
        contactId = matches[0].id;
        contactMatchStrength = "name";
      }
    }
  }

  let projectId: string | null = null;
  if (input.projectMention) {
    const mention = input.projectMention.trim();
    const { data } = await supabase
      .from("projects")
      .select("id, display_name, aliases")
      .or(`display_name.ilike.%${mention}%`)
      .limit(2);
    if (data && data.length === 1) {
      projectId = data[0].id;
    } else if (data && data.length > 1) {
      const alias = data.find((p) => (p.aliases ?? []).some((a: string) => mention.toLowerCase().includes(a.toLowerCase())));
      if (alias) projectId = alias.id;
    } else {
      // Same reverse-containment fallback as contacts, plus alias matching
      // across the full table (not just the narrowed ilike candidates).
      const { data: all } = await supabase.from("projects").select("id, display_name, aliases");
      const matches = (all ?? []).filter(
        (p) =>
          mention.toLowerCase().includes(p.display_name.trim().toLowerCase()) ||
          (p.aliases ?? []).some((a: string) => mention.toLowerCase().includes(a.toLowerCase())),
      );
      if (matches.length === 1) projectId = matches[0].id;
    }
  }

  let categoryId: string | null = null;
  if (input.suggestedCategory) {
    const { data } = await supabase
      .from("categories")
      .select("id")
      .ilike("name", input.suggestedCategory.trim())
      .maybeSingle();
    if (data) categoryId = data.id;
  }

  return { contactId, contactMatchStrength, projectId, categoryId };
}
