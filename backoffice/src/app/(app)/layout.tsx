import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyOrgs } from "@/lib/supabase/org";
import { getAccessContext } from "@/lib/supabase/access";
import { Nav } from "./Nav";
import { loadInboxCounts } from "@/lib/data/inboxCount";
import { inboxTotal } from "@/lib/ingest/inboxCount";
import { ToastProvider } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy already bounces partners off finance paths; this is the
  // second line, so a partner never reaches getCurrentOrgId() (which throws
  // for anyone without an org) and never renders the finance shell.
  const access = await getAccessContext();
  if (access.kind === "anonymous") redirect("/login");
  if (access.kind === "partner") redirect("/collab");

  const supabase = await createClient();
  const [orgs, inboxCount] = await Promise.all([
    listMyOrgs(supabase),
    // Viewers cannot review or approve, so no badge for them (the inbox is
    // hidden too). Rows to review + AI changes + canvas proposals.
    access.membership.role === "viewer" ? 0 : loadInboxCounts(access.membership.orgId).then(inboxTotal),
  ]);

  // One toast strip for the whole app («Αποθηκεύτηκε», an error): any
  // client component calls useToast().show(...).
  return (
    <ToastProvider>
      <Nav
        orgs={orgs}
        currentOrgId={access.membership.orgId}
        role={access.membership.role}
        inboxCount={inboxCount}
      >
        {children}
      </Nav>
    </ToastProvider>
  );
}
