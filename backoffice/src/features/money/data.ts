import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { loadLookups, type LookupKind } from "@/lib/data/lookups";
import type { OrgRole } from "@/lib/domain/enums";

// «Χρήματα» is staff only. The proxy and the (app) layout already send a
// partner to /collab; this is the line every tab crosses itself, since a
// page renders alongside (not after) its layouts.
export async function requireInternal(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  orgId: string;
  role: OrgRole;
  canEdit: boolean;
}> {
  const access = await getAccessContext();
  if (access.kind === "anonymous") redirect("/login");
  if (access.kind === "partner") redirect("/collab");
  const { orgId, role } = access.membership;
  return { supabase: await createClient(), orgId, role, canEdit: role !== "viewer" };
}

export type Options = Record<LookupKind, { id: string; label: string }[]>;

// The pick-lists as { id, label } options.
export async function loadOptions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  include?: LookupKind[],
): Promise<Options> {
  const l = await loadLookups(supabase, orgId, include ? { include } : undefined);
  return {
    contacts: l.contacts.map((c) => ({ id: c.id, label: c.name })),
    projects: l.projects.map((p) => ({ id: p.id, label: p.display_name })),
    categories: l.categories.map((c) => ({ id: c.id, label: c.name })),
    accounts: l.accounts.map((a) => ({ id: a.id, label: a.name })),
  };
}

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;
