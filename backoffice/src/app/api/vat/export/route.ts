import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponseHeaders } from "@/lib/csv";

// The thing a λογιστής actually needs every filing period -- VAT position
// by month, not just the ledger rows behind it.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({ error: "Μη εξουσιοδοτημένο." }, { status: 401 });

  const [{ data: positions, error }, { data: filings }] = await Promise.all([
    supabase.from("v_vat_position").select("*").order("period_start", { ascending: true }),
    supabase.from("vat_periods").select("*"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const filingByPeriod = new Map((filings ?? []).map((f) => [f.period_start, f]));

  const header = ["Περίοδος", "ΦΠΑ Εκροών", "ΦΠΑ Εισροών", "Πιστωτικό", "Πληρωτέο", "Προθεσμία", "Κατάσταση"];
  const rows = (positions ?? []).map((p) => {
    const filing = filingByPeriod.get(p.period_start!);
    const filed = filing?.status === "filed" || filing?.status === "paid";
    return [
      p.period_start,
      p.vat_income,
      p.vat_expense,
      Math.abs(p.credit_balance ?? 0),
      p.payable_after_credit,
      p.filing_deadline,
      filed ? "Υποβλήθηκε" : "Εκκρεμεί",
    ];
  });

  return new NextResponse(toCsv(header, rows), { headers: csvResponseHeaders("fpa") });
}
