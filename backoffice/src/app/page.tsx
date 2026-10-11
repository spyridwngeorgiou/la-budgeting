import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/supabase/org";
import { resolveHomePath } from "@/lib/homePath";
import { Landing } from "./landing/Landing";

// "/" is two things. A visitor who is not signed in gets the public Kansha
// page (static, nothing from the database). Signed-in staff land on the page
// they chose in Settings → Προσωπικά (profiles.home_path), else the
// Επισκόπηση; partners never get here -- the proxy keeps them in /collab.
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <Landing />;
  const profile = await getMyProfile(supabase);
  redirect(resolveHomePath(profile?.home_path));
}
