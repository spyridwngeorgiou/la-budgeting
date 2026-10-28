import { NextResponse } from "next/server";
import { createSession } from "@/lib/bank/enableBanking";
import { APP_URL, BANKS, BANK_FEED_START, serviceClient } from "@/lib/bank/service";

// The bank sends the user back here after consent. We trade the code for a
// session, store each bank account and point it at the matching ledger
// account (changeable on /bank). The proxy already requires a signed-in user.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (q: string) => NextResponse.redirect(`${APP_URL}/bank?${q}`);
  if (!code || !state) return back(`error=${encodeURIComponent(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "Η τράπεζα δεν έδωσε έγκριση.")}`);

  const sb = serviceClient();
  const { data: conn } = await sb.from("bank_connections").select("id, org_id, aspsp_name, psu_type, status").eq("auth_state", state).maybeSingle();
  if (!conn || conn.status !== "pending") return back("error=Η σύνδεση έληξε ή έχει ήδη χρησιμοποιηθεί. Ξεκίνα ξανά.");

  try {
    const session = await createSession(code);
    await sb.from("bank_connections").update({ status: "active", session_id: session.session_id, valid_until: session.access?.valid_until ?? null, auth_state: null }).eq("id", conn.id);
    const preset = BANKS.find((b) => b.aspsp === conn.aspsp_name && b.psuType === conn.psu_type);
    const { data: ledger } = await sb.from("accounts").select("id, name").eq("org_id", conn.org_id);
    const defaultAccount = ledger?.find((a) => a.name === preset?.account)?.id ?? null;
    for (const a of session.accounts ?? []) {
      await sb.from("bank_links").upsert({
        org_id: conn.org_id, connection_id: conn.id, account_uid: a.uid,
        iban: a.account_id?.iban ?? null, bank_account_no: a.account_id?.other?.identification ?? null,
        name: a.name ?? a.product ?? a.details ?? null, currency: a.currency ?? null,
        account_id: (session.accounts ?? []).length === 1 ? defaultAccount : null,
        sync_from: BANK_FEED_START,
      }, { onConflict: "connection_id,account_uid" });
    }
    return back("connected=1");
  } catch (e) {
    await sb.from("bank_connections").update({ status: "failed" }).eq("id", conn.id);
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 200) : "Αποτυχία σύνδεσης.")}`);
  }
}
