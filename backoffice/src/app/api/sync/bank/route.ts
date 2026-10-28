import { NextResponse } from "next/server";
import { bankConfigured } from "@/lib/bank/enableBanking";
import { serviceClient } from "@/lib/bank/service";
import { syncBank } from "@/lib/bank/sync";

// Bank feed, 3 times a day (pg_cron + pg_net, migration 0033), with the
// shared SYNC_SECRET. One run per org that has an active bank connection.
export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secret || request.headers.get("x-sync-secret") !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  if (!bankConfigured()) return NextResponse.json({ ok: false, error: "bank not configured" }, { status: 500 });
  const sb = serviceClient();
  const { data: conns } = await sb.from("bank_connections").select("org_id").eq("status", "active");
  const results = [];
  for (const orgId of [...new Set((conns ?? []).map((c) => c.org_id))]) {
    try {
      results.push({ org: orgId, ...(await syncBank(sb, orgId)) });
    } catch (e) {
      results.push({ org: orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
