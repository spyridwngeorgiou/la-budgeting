import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, listMyOrgs } from "@/lib/supabase/org";
import { Nav } from "./Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [currentOrgId, orgs] = await Promise.all([getCurrentOrgId(supabase), listMyOrgs(supabase)]);

  return (
    <Nav orgs={orgs} currentOrgId={currentOrgId}>
      {children}
    </Nav>
  );
}
