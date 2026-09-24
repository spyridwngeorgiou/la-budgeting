"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { switchOrg as switchOrgCookie } from "@/lib/supabase/org";

export async function switchOrg(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const supabase = await createClient();
  await switchOrgCookie(supabase, orgId);
  // Every page reads org_id fresh from the request; a full redirect (rather
  // than revalidatePath) is the simplest way to guarantee every layer --
  // layout, page, every query inside it -- re-runs against the new org
  // instead of leaving stale client-cached data from the previous one.
  redirect("/dashboard");
}
