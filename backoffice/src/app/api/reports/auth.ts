import { NextResponse } from "next/server";
import { getAccessContext } from "@/lib/supabase/access";

// The report exports are for the same people as the report tabs: org
// members (viewers included). Partners never see finance (the (app) layout
// sends them to /collab), so they get a 403 here too.
export async function reportExportOrg(): Promise<{ orgId: string } | NextResponse> {
  const access = await getAccessContext();
  if (access.kind === "anonymous") return NextResponse.json({ error: "Μη εξουσιοδοτημένο." }, { status: 401 });
  if (access.kind !== "internal") return NextResponse.json({ error: "Δεν επιτρέπεται." }, { status: 403 });
  return { orgId: access.membership.orgId };
}
