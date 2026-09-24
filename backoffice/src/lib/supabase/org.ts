import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// The org the user last explicitly picked, when they belong to more than
// one. Only ever written by switchOrg() (a Server Action, the one place
// Next.js allows a cookie write outside a Route Handler) -- every read here
// is tolerant of the cookie being absent, stale (an org they've since left),
// or simply not applicable (the common case: exactly one membership).
const ORG_COOKIE = "kansha_org_id";

// Every insert must carry org_id explicitly -- RLS's `with check` clause
// requires it to already be present on the row, it isn't inferred.
//
// Resolution order: the cookie, if it names an org this user actually
// belongs to; otherwise the first membership by created_at (deterministic --
// "first joined", not whatever order Postgres felt like returning). A
// second org existing must never silently redirect data to the wrong one,
// so this never falls back to an unordered pick.
async function resolveMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ orgId: string; role: "viewer" | "editor" | "admin" | "owner" }> {
  const cookieStore = await cookies();
  const selected = cookieStore.get(ORG_COOKIE)?.value;

  if (selected) {
    const { data } = await supabase
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", userId)
      .eq("org_id", selected)
      .maybeSingle();
    if (data) return { orgId: data.org_id, role: data.role };
    // Cookie names an org this user no longer belongs to (removed, or a
    // stale cookie from another account on the same browser) -- fall
    // through to the deterministic default rather than erroring.
  }

  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) throw new Error("Ο χρήστης δεν ανήκει σε κάποιον οργανισμό.");
  return { orgId: data.org_id, role: data.role };
}

// Uses getSession() (decodes the cookie locally), not getUser() (a network
// round-trip to Auth to revalidate). The proxy middleware already called
// getUser() once for this exact request to decide whether to redirect to
// /login -- every page and action re-verifying again is a second network
// round trip for no additional safety, and it was showing up as real,
// measurable per-page latency.
export async function getCurrentOrgId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");

  const { orgId } = await resolveMembership(supabase, session.user.id);
  return orgId;
}

// Same shape as getCurrentOrgId but also returns the caller's own role --
// needed wherever a feature must gate itself on "am I admin/owner" beyond
// what RLS alone enforces (e.g. team-management actions that use a
// service-role client and so bypass RLS entirely, meaning the app itself is
// the only authorization boundary left).
export async function getCurrentMembership(
  supabase: SupabaseClient,
): Promise<{ orgId: string; role: "viewer" | "editor" | "admin" | "owner" }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");

  return resolveMembership(supabase, session.user.id);
}

// For read-only display. Unlike getCurrentOrgId/getCurrentMembership this
// can't skip the org_members hop when a switcher exists -- RLS scopes
// `orgs` to *every* org the caller belongs to, so an unordered
// `.limit(1).single()` here would be exactly the bug this file exists to
// fix. Goes through the same cookie-or-deterministic-default resolution,
// then fetches that one row by id.
export async function getCurrentOrg(supabase: SupabaseClient) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");

  const { orgId } = await resolveMembership(supabase, session.user.id);
  const { data, error } = await supabase.from("orgs").select("*").eq("id", orgId).single();
  if (error || !data) throw new Error("Ο χρήστης δεν ανήκει σε κάποιον οργανισμό.");
  return data;
}

// All orgs the caller belongs to, for the switcher -- and to decide whether
// to render it at all (hidden entirely for the common single-org case).
export async function listMyOrgs(supabase: SupabaseClient) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return [];

  const { data } = await supabase
    .from("org_members")
    .select("org_id, orgs(name)")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => {
    const org = Array.isArray(row.orgs) ? row.orgs[0] : row.orgs;
    return { id: row.org_id, name: org?.name ?? "—" };
  });
}

export async function getSelectedOrgId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ORG_COOKIE)?.value ?? null;
}

// Server Action only -- cookies().set() throws outside that context (and
// inside Route Handlers, which this app doesn't use for this). Verifies
// membership itself rather than trusting the caller, since this is the one
// place a stale/forged org id would actually stick past a single request.
export async function switchOrg(supabase: SupabaseClient, orgId: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");

  const { data } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) throw new Error("Δεν ανήκετε σε αυτόν τον οργανισμό.");

  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

// FormData values are string | File | null; every select/hidden field we
// read is always a plain string or absent -- this narrows that safely
// instead of casting, so a stray <input type="file"> can't silently produce
// garbage in a money or foreign-key field.
export function formString(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string" || value === "") return null;
  return value;
}
