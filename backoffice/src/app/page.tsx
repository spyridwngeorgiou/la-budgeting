import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/supabase/org";
import { resolveHomePath } from "@/lib/homePath";

// Login and magic links land here: open the page the user chose in
// Settings → Προσωπικά (profiles.home_path), else the dashboard. One query.
// Partners never get here -- the proxy already keeps them in /collab.
export default async function RootPage() {
  const supabase = await createClient();
  const profile = await getMyProfile(supabase);
  redirect(resolveHomePath(profile?.home_path));
}
