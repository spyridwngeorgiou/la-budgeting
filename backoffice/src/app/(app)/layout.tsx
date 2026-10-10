import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyOrgs } from "@/lib/supabase/org";
import { getAccessContext } from "@/lib/supabase/access";
import { Nav } from "./Nav";
import { countPendingChanges } from "@/lib/data/pendingChanges";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy already bounces partners off finance paths; this is the
  // second line, so a partner never reaches getCurrentOrgId() (which throws
  // for anyone without an org) and never renders the finance shell.
  const access = await getAccessContext();
  if (access.kind === "anonymous") redirect("/login");
  if (access.kind === "partner") redirect("/collab");

  const supabase = await createClient();
  const [orgs, pendingChanges] = await Promise.all([
    listMyOrgs(supabase),
    // Viewers cannot approve, so no badge for them (the panel is hidden too).
    access.membership.role === "viewer" ? 0 : countPendingChanges(access.membership.orgId),
  ]);

  return (
    <Nav
      orgs={orgs}
      currentOrgId={access.membership.orgId}
      role={access.membership.role}
      pendingChanges={pendingChanges}
    >
      {children}
    </Nav>
  );
}
