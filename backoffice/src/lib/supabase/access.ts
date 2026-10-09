import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/supabase/org";
import type { OrgRole, ProjectRole } from "@/lib/domain/enums";

// Who is this, in one place: internal staff (an org membership) or an
// external project partner (project_members rows only). Unlike
// getCurrentMembership() this never throws for a partner -- a partner has
// no org by design (0037), and layouts need to route them, not crash.
//
// Wrapped in React cache() so a layout and its page asking in the same
// request cost one lookup, not two.
export type AccessContext =
  | { kind: "anonymous" }
  | {
      kind: "internal";
      userId: string;
      email: string | null;
      membership: { orgId: string; role: OrgRole };
      partnerProjectIds: string[];
    }
  | {
      kind: "partner";
      userId: string;
      email: string | null;
      membership: null;
      partnerProjectIds: string[];
      projectRoles: Record<string, ProjectRole>;
    };

export const getAccessContext = cache(async (): Promise<AccessContext> => {
  const supabase = await createClient();
  // getSession, not getUser: the proxy already re-validated this request's
  // token with Auth (see org.ts for the latency reasoning).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return { kind: "anonymous" };
  const userId = session.user.id;
  const email = session.user.email ?? null;

  const [{ data: orgRow }, { data: projectRows }] = await Promise.all([
    supabase.from("org_members").select("org_id").eq("user_id", userId).limit(1).maybeSingle(),
    supabase.from("project_members").select("project_id, role").eq("user_id", userId),
  ]);
  const partnerProjectIds = (projectRows ?? []).map((r) => r.project_id);

  if (orgRow) {
    const membership = await getCurrentMembership(supabase);
    return { kind: "internal", userId, email, membership, partnerProjectIds };
  }

  return {
    kind: "partner",
    userId,
    email,
    membership: null,
    partnerProjectIds,
    projectRoles: Object.fromEntries((projectRows ?? []).map((r) => [r.project_id, r.role])),
  };
});
