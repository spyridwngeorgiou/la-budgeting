import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mydataCredentials, syncMydata } from "@/lib/aade/mydataApi";

// Daily myDATA sync, called by the database scheduler (pg_cron + pg_net) with
// the shared SYNC_SECRET. Runs with the service key because no user is signed
// in; it only stages new invoices for review, it never commits them.
export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secret || request.headers.get("x-sync-secret") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const creds = mydataCredentials();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!creds || !url || !key) return NextResponse.json({ ok: false, error: "missing configuration" }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false }, global: { headers: { "x-actor-email": "mydata-sync" } } });
  const { data: orgs } = await supabase.from("orgs").select("id, own_afm").neq("own_afm", "000000000");
  const results = [];
  for (const org of orgs ?? []) {
    try {
      results.push({ org: org.id, ...(await syncMydata(supabase, org, creds)) });
    } catch (e) {
      results.push({ org: org.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
