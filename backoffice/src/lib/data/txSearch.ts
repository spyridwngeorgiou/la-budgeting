// Server-side search for /transactions (and its CSV export): one text box
// over description, invoice number, contact, project and category, across
// every matching row -- not just the page on screen. Contact / project /
// category names live in other tables, so their matches are resolved to ids
// first and folded into one PostgREST or().
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// PostgREST or() syntax characters, wildcards and quotes are dropped rather
// than escaped: a search box never needs them, and a stray "," or ")" must
// not be able to change the filter.
export function cleanSearch(raw: string | null | undefined): string | null {
  const q = (raw ?? "")
    .replace(/[,()*%\\"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return q.length >= 2 ? q : null;
}

const MAX_IDS = 200;

// The or() filter for `q`, or null when there is nothing to search for.
export async function txSearchFilter(
  supabase: SupabaseClient<Database>,
  orgId: string,
  rawQuery: string | null | undefined,
): Promise<string | null> {
  const q = cleanSearch(rawQuery);
  if (!q) return null;
  const like = `%${q}%`;
  const [contacts, projects, categories] = await Promise.all([
    supabase.from("contacts").select("id").eq("org_id", orgId).ilike("name", like).limit(MAX_IDS),
    supabase.from("projects").select("id").eq("org_id", orgId).or(`display_name.ilike."*${q}*",code.ilike."*${q}*"`).limit(MAX_IDS),
    supabase.from("categories").select("id").eq("org_id", orgId).ilike("name", like).limit(MAX_IDS),
  ]);
  const ids = (rows: { id: string }[] | null) => (rows ?? []).map((r) => r.id);
  const parts = [`description.ilike."*${q}*"`, `invoice_number.ilike."*${q}*"`];
  const add = (column: string, list: string[]) => {
    if (list.length) parts.push(`${column}.in.(${list.join(",")})`);
  };
  add("contact_id", ids(contacts.data));
  add("project_id", ids(projects.data));
  add("category_id", ids(categories.data));
  return parts.join(",");
}
