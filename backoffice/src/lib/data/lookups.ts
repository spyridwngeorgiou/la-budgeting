import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// The pick-lists every entry form needs (contacts, projects, categories,
// accounts), scoped to the current org and cached for the request: a page
// and its layout asking for the same list hit the database once.

export interface Lookups {
  contacts: { id: string; name: string }[];
  projects: { id: string; display_name: string }[];
  categories: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
}
export type LookupKind = keyof Lookups;

const ALL: LookupKind[] = ["contacts", "projects", "categories", "accounts"];

type Client = SupabaseClient<Database>;

// React cache keys on argument identity, so the cached unit is one table.
const loadOne = cache(async (supabase: Client, orgId: string, kind: LookupKind): Promise<Lookups[LookupKind]> => {
  switch (kind) {
    case "contacts": {
      const { data } = await supabase.from("contacts").select("id, name").eq("org_id", orgId).order("name");
      return data ?? [];
    }
    case "projects": {
      const { data } = await supabase.from("projects").select("id, display_name").eq("org_id", orgId).order("sort_order");
      return data ?? [];
    }
    case "categories": {
      const { data } = await supabase.from("categories").select("id, name").eq("org_id", orgId).order("sort_order");
      return data ?? [];
    }
    case "accounts": {
      const { data } = await supabase.from("accounts").select("id, name").eq("org_id", orgId).order("sort_order");
      return data ?? [];
    }
  }
});

export async function loadLookups(
  supabase: Client,
  orgId: string,
  { include = ALL }: { include?: LookupKind[] } = {},
): Promise<Lookups> {
  const lists = await Promise.all(include.map((kind) => loadOne(supabase, orgId, kind)));
  const out: Lookups = { contacts: [], projects: [], categories: [], accounts: [] };
  include.forEach((kind, i) => {
    (out as unknown as Record<LookupKind, unknown>)[kind] = lists[i];
  });
  return out;
}
