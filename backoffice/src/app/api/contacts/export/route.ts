import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponseHeaders } from "@/lib/csv";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({ error: "Μη εξουσιοδοτημένο." }, { status: 401 });

  const { data, error } = await supabase.from("v_contact_rollup").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = ["Όνομα", "ΑΦΜ", "Σύνολο Εσόδων", "Σύνολο Εξόδων", "Εκκρεμές", "Καθαρό Υπόλοιπο"];
  const rows = (data ?? []).map((c) => [
    c.name,
    c.afm ?? "",
    c.total_income,
    c.total_expense,
    c.outstanding,
    c.net_balance,
  ]);

  return new NextResponse(toCsv(header, rows), { headers: csvResponseHeaders("epafes") });
}
