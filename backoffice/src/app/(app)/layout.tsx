import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyOrgs } from "@/lib/supabase/org";
import { getAccessContext } from "@/lib/supabase/access";
import { Nav } from "./Nav";
import { countPendingChanges } from "@/lib/data/pendingChanges";
import { loadPendingCaptures } from "@/lib/ingest/pendingCaptures";
import { getUiVersion } from "@/lib/ui/version";
import { AppShell } from "@/components/shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy already bounces partners off finance paths; this is the
  // second line, so a partner never reaches getCurrentOrgId() (which throws
  // for anyone without an org) and never renders the finance shell.
  const access = await getAccessContext();
  if (access.kind === "anonymous") redirect("/login");
  if (access.kind === "partner") redirect("/collab");

  const supabase = await createClient();
  const { orgId, role } = access.membership;
  const version = await getUiVersion("app");
  // Viewers cannot approve, so no badge for them (the panel is hidden too).
  const canApprove = role !== "viewer";
  const [orgs, pendingChanges, pendingCaptures] = await Promise.all([
    listMyOrgs(supabase),
    canApprove ? countPendingChanges(orgId) : 0,
    // The v2 «Εκκρεμότητες» count also includes AI captures waiting for
    // review (Phase 2 replaces both with one count from v_approvals).
    canApprove && version === "v2" ? loadPendingCaptures(supabase, orgId).then((p) => p.count) : 0,
  ]);

  if (version === "v2") {
    return (
      <AppShell
        role={role}
        orgs={orgs}
        currentOrgId={orgId}
        email={access.email}
        pendingCount={pendingChanges + pendingCaptures}
      >
        {children}
      </AppShell>
    );
  }

  return (
    <Nav orgs={orgs} currentOrgId={orgId} role={role} pendingChanges={pendingChanges}>
      {children}
    </Nav>
  );
}
