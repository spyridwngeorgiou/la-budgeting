import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stageMoneyManager } from "@/lib/moneyManager";

// Receives the Money Manager Excel export from the iPhone shortcut
// («Στείλε στην Kansha») and stages it for review on /money-manager.
// Auth: the personal IMPORT_KEY in the x-import-key header. The answer is a
// short Greek sentence that the shortcut shows on the phone.
export async function POST(request: Request) {
  const key = process.env.IMPORT_KEY;
  if (!key || request.headers.get("x-import-key") !== key) return new NextResponse("Μη έγκυρο κλειδί.", { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return new NextResponse("Λείπουν ρυθμίσεις στον server.", { status: 500 });

  // The shortcut may send the file as the raw body or as form field "file".
  let buffer: ArrayBuffer;
  let name: string | null = null;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = [...form.values()].find((v): v is File => v instanceof File);
    if (!file) return new NextResponse("Δεν βρέθηκε αρχείο.", { status: 400 });
    buffer = await file.arrayBuffer();
    name = file.name;
  } else {
    buffer = await request.arrayBuffer();
  }
  if (!buffer.byteLength) return new NextResponse("Το αρχείο είναι άδειο.", { status: 400 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false }, global: { headers: { "x-actor-email": "money-manager" } } });
  const { data: org } = await supabase.from("orgs").select("id").neq("own_afm", "000000000").limit(1).single();
  if (!org) return new NextResponse("Δεν βρέθηκε επιχείρηση.", { status: 500 });

  const path = `${org.id}/money-manager/${Date.now()}.xlsx`;
  await supabase.storage.from("aade-imports").upload(path, buffer, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  try {
    const r = await stageMoneyManager(supabase, org.id, { name, buffer, storagePath: path });
    const msg = r.already
      ? "Αυτό το αρχείο έχει ήδη σταλεί — τίποτα καινούργιο."
      : `✓ ${r.rows} κινήσεις: ${r.exists} υπάρχουν ήδη, ${r.fresh} νέες περιμένουν έγκριση στην εφαρμογή.`;
    return new NextResponse(msg, { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (e) {
    return new NextResponse(`Δεν διαβάστηκε: ${e instanceof Error ? e.message : String(e)}`, { status: 422 });
  }
}
