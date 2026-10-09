import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/supabase/org";
import { plannerCapabilities } from "@/lib/planner/access";
import { todayAthens } from "@/lib/dates";
import { loadPlannerProjects } from "@/lib/planner/queries";

// What every /planner page needs: the client, the viewer's capabilities,
// the current org's plannable projects, and the URL filters, validated.

type SearchParams = Record<string, string | string[] | undefined>;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function plannerContext(searchParams: SearchParams) {
  const supabase = await createClient();
  const [membership, session] = await Promise.all([
    getCurrentMembership(supabase),
    supabase.auth.getSession().then((r) => r.data.session),
  ]);
  const projects = await loadPlannerProjects(supabase, membership.orgId);

  const project = one(searchParams.project);
  const assignee = one(searchParams.assignee);
  const q = one(searchParams.q)?.trim().slice(0, 200);
  const projectId = project && GUID.test(project) && projects.some((p) => p.id === project) ? project : null;

  return {
    supabase,
    orgId: membership.orgId,
    userId: session?.user.id ?? null,
    caps: plannerCapabilities({ kind: "member", role: membership.role }),
    today: todayAthens(),
    projects,
    projectLabels: Object.fromEntries(projects.map((p) => [p.id, p.display_name])),
    filters: {
      projectId,
      assignee: assignee === "none" || (assignee && GUID.test(assignee)) ? assignee : null,
      q: q || null,
      archived: one(searchParams.archived) === "1",
    },
  };
}

// Rebuilds a /planner URL with one param changed, for server-rendered links.
export function withParam(base: string, params: SearchParams, key: string, value: string | null): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = one(v);
    if (s && k !== key) next.set(k, s);
  }
  if (value) next.set(key, value);
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}
